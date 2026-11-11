//! Written once by `gen-tables.mts` from the frozen TypeScript; since the cutover (T88.6) the
//! source of these tables, edited here.
//! The script views (`script-views.ts`), the game API (`script-api.ts`) and the default scripts'
//! names and sources (`default-scripts.ts`).

use crate::script_api::{Is, ScriptBinding};
use crate::script_views::{ScriptField, ScriptType, ScriptView, ViewChange};
use csp_shared::world::Task;

/// Every script view by name, in the TypeScript's order (`SCRIPT_VIEWS`).
pub static SCRIPT_VIEWS: &[ScriptView] = &[
    ScriptView {
        name: "resident",
        description: "A resident, as the Player sees them; `me` in a resident’s script.",
        fields: &[
            ScriptField {
                name: "id",
                r#type: ScriptType::String,
                description: "The resident’s id, unique in the world.",
                null_when: None,
            },
            ScriptField {
                name: "name",
                r#type: ScriptType::String,
                description: "The resident’s name.",
                null_when: None,
            },
            ScriptField {
                name: "owner",
                r#type: ScriptType::String,
                description: "The realm they belong to.",
                null_when: Some("for a resident of an NPC city or of nobody"),
            },
            ScriptField {
                name: "cityId",
                r#type: ScriptType::String,
                description: "The city they live in.",
                null_when: Some("for a resident of no city"),
            },
            ScriptField {
                name: "x",
                r#type: ScriptType::Number,
                description: "The tile it stands on, from west to east.",
                null_when: None,
            },
            ScriptField {
                name: "y",
                r#type: ScriptType::Number,
                description: "The tile it stands on, from north to south.",
                null_when: None,
            },
            ScriptField {
                name: "stats",
                r#type: ScriptType::View("stats"),
                description: "Strength, endurance, agility and intellect.",
                null_when: None,
            },
            ScriptField {
                name: "skills",
                r#type: ScriptType::View("skills"),
                description: "What they have learned by doing.",
                null_when: None,
            },
            ScriptField {
                name: "health",
                r#type: ScriptType::Number,
                description: "0 is dead; full is 100.",
                null_when: Some("for a resident of another realm that isn’t allied"),
            },
            ScriptField {
                name: "hunger",
                r#type: ScriptType::Number,
                description: "Fully fed is 100, empty 0.",
                null_when: Some("for a resident of another realm that isn’t allied"),
            },
            ScriptField {
                name: "down",
                r#type: ScriptType::Boolean,
                description: "Whether they are Down: lying unconscious from hunger, doing nothing and taking no orders.",
                null_when: None,
            },
            ScriptField {
                name: "downUntil",
                r#type: ScriptType::Number,
                description: "The tick at which they die of hunger unless revived.",
                null_when: Some("unless they are Down, and for a resident of another realm that isn’t allied"),
            },
            ScriptField {
                name: "struckBy",
                r#type: ScriptType::String,
                description: "The id of the resident who last struck them, a dodged blow too.",
                null_when: Some("until someone does, once that resident is gone, and for a resident of another realm that isn’t allied"),
            },
            ScriptField {
                name: "struckAt",
                r#type: ScriptType::Number,
                description: "The tick they were last struck.",
                null_when: Some("whenever `struckBy` is"),
            },
            ScriptField {
                name: "defenceScript",
                r#type: ScriptType::Number,
                description: "The id of the script they run when struck, picked on their card.",
                null_when: Some("for the Defend default, and for a resident of another Player"),
            },
            ScriptField {
                name: "alarmScript",
                r#type: ScriptType::Any,
                description: "What they run when an alarm reaches them, picked on their card: a script’s id, or \"none\" for nothing.",
                null_when: Some("for the Alarm default, and for a resident of another Player"),
            },
            ScriptField {
                name: "alarm",
                r#type: ScriptType::View("alarm"),
                description: "The alarm their Alarm script runs for.",
                null_when: Some("except on `me` while my Alarm script runs"),
            },
            ScriptField {
                name: "knownThief",
                r#type: ScriptType::Boolean,
                description: "Whether my realm knows they stole from it, or one of my residents saw it. In my own City area, striking them is no crime.",
                null_when: Some("except from `residents()`"),
            },
            ScriptField {
                name: "bornAt",
                r#type: ScriptType::Number,
                description: "The tick they were born; may be before the world began.",
                null_when: None,
            },
            ScriptField {
                name: "age",
                r#type: ScriptType::Number,
                description: "Their age in game years.",
                null_when: Some("except on `me` and an army’s `members`"),
            },
            ScriptField {
                name: "lifespan",
                r#type: ScriptType::Number,
                description: "The age in game years at which they die of old age.",
                null_when: None,
            },
            ScriptField {
                name: "carried",
                r#type: ScriptType::View("goods"),
                description: "The goods they carry.",
                null_when: None,
            },
            ScriptField {
                name: "order",
                r#type: ScriptType::View("residentOrder"),
                description: "What they were ordered to do.",
                null_when: Some("when idle"),
            },
            ScriptField {
                name: "orderEnded",
                r#type: ScriptType::View("orderEnded"),
                description: "How their last store, fetch or relocate order ended.",
                null_when: Some("until one ended, and after their next store, fetch or relocate order or an order from the UI"),
            },
            ScriptField {
                name: "queue",
                r#type: ScriptType::View("queue"),
                description: "The queue they work through; `order` or `script` is its current step’s.",
                null_when: Some("when they have none, and for a resident of another realm"),
            },
            ScriptField {
                name: "pair",
                r#type: ScriptType::View("pair"),
                description: "Their pair, to have a child.",
                null_when: Some("unless they are paired"),
            },
            ScriptField {
                name: "carrying",
                r#type: ScriptType::View("carrying"),
                description: "The child they carry.",
                null_when: Some("unless they carry one"),
            },
            ScriptField {
                name: "riding",
                r#type: ScriptType::String,
                description: "The id of the horse they ride.",
                null_when: Some("unless they ride one"),
            },
            ScriptField {
                name: "aboard",
                r#type: ScriptType::String,
                description: "The id of the carriage they ride on as a passenger.",
                null_when: Some("unless they are aboard one"),
            },
            ScriptField {
                name: "script",
                r#type: ScriptType::View("runningScript"),
                description: "The script they run.",
                null_when: Some("when they run none, and on `me` (a script’s own state is `memory`)"),
            },
        ],
    },
    ScriptView {
        name: "army",
        description: "An army of the Player’s realm; `me` in an army’s script.",
        fields: &[
            ScriptField {
                name: "id",
                r#type: ScriptType::String,
                description: "The army’s id, unique in the world.",
                null_when: None,
            },
            ScriptField {
                name: "name",
                r#type: ScriptType::String,
                description: "The name the Player gave it.",
                null_when: None,
            },
            ScriptField {
                name: "realmId",
                r#type: ScriptType::String,
                description: "The realm it belongs to.",
                null_when: None,
            },
            ScriptField {
                name: "memberIds",
                r#type: ScriptType::List(&ScriptType::String),
                description: "Its residents’ ids; never empty.",
                null_when: None,
            },
            ScriptField {
                name: "members",
                r#type: ScriptType::List(&ScriptType::View("resident")),
                description: "Its residents, as the Player sees them, with their `age`.",
                null_when: None,
            },
            ScriptField {
                name: "struckBy",
                r#type: ScriptType::String,
                description: "Who last struck one of its members: the `struckBy` of the member struck last.",
                null_when: Some("until a member is struck, and once that attacker is gone"),
            },
            ScriptField {
                name: "struckAt",
                r#type: ScriptType::Number,
                description: "The tick one of its members was last struck.",
                null_when: Some("whenever `struckBy` is"),
            },
            ScriptField {
                name: "order",
                r#type: ScriptType::View("armyOrder"),
                description: "What it was ordered to do.",
                null_when: Some("when idle"),
            },
        ],
    },
    ScriptView {
        name: "stats",
        description: "A resident’s stats.",
        fields: &[
            ScriptField {
                name: "strength",
                r#type: ScriptType::View("stat"),
                description: "Their strength.",
                null_when: None,
            },
            ScriptField {
                name: "endurance",
                r#type: ScriptType::View("stat"),
                description: "Their endurance.",
                null_when: None,
            },
            ScriptField {
                name: "agility",
                r#type: ScriptType::View("stat"),
                description: "Their agility.",
                null_when: None,
            },
            ScriptField {
                name: "intellect",
                r#type: ScriptType::View("stat"),
                description: "Their intellect.",
                null_when: None,
            },
        ],
    },
    ScriptView {
        name: "stat",
        description: "One stat: what they were born with and what training added.",
        fields: &[
            ScriptField {
                name: "base",
                r#type: ScriptType::Number,
                description: "What they were born with.",
                null_when: None,
            },
            ScriptField {
                name: "trained",
                r#type: ScriptType::Number,
                description: "What training added, at most the base.",
                null_when: None,
            },
        ],
    },
    ScriptView {
        name: "skills",
        description: "What a resident has learned by doing; a skill they haven’t learned is null (0).",
        fields: &[
            ScriptField {
                name: "mining",
                r#type: ScriptType::Number,
                description: "How far they have learned mining.",
                null_when: Some("until they start learning it"),
            },
            ScriptField {
                name: "woodcutting",
                r#type: ScriptType::Number,
                description: "How far they have learned woodcutting.",
                null_when: Some("until they start learning it"),
            },
            ScriptField {
                name: "smelting",
                r#type: ScriptType::Number,
                description: "How far they have learned smelting.",
                null_when: Some("until they start learning it"),
            },
            ScriptField {
                name: "smithing",
                r#type: ScriptType::Number,
                description: "How far they have learned smithing.",
                null_when: Some("until they start learning it"),
            },
            ScriptField {
                name: "construction",
                r#type: ScriptType::Number,
                description: "How far they have learned construction.",
                null_when: Some("until they start learning it"),
            },
            ScriptField {
                name: "farming",
                r#type: ScriptType::Number,
                description: "How far they have learned farming.",
                null_when: Some("until they start learning it"),
            },
            ScriptField {
                name: "combat",
                r#type: ScriptType::Number,
                description: "How far they have learned combat.",
                null_when: Some("until they start learning it"),
            },
            ScriptField {
                name: "driving",
                r#type: ScriptType::Number,
                description: "How far they have learned driving.",
                null_when: Some("until they start learning it"),
            },
        ],
    },
    ScriptView {
        name: "goods",
        description: "Goods by kind, in units, like {food: 3, wood: 10}.",
        fields: &[
            ScriptField {
                name: "food",
                r#type: ScriptType::Number,
                description: "Units of food.",
                null_when: Some("when there are none"),
            },
            ScriptField {
                name: "wood",
                r#type: ScriptType::Number,
                description: "Units of wood.",
                null_when: Some("when there are none"),
            },
            ScriptField {
                name: "stone",
                r#type: ScriptType::Number,
                description: "Units of stone.",
                null_when: Some("when there are none"),
            },
            ScriptField {
                name: "ironOre",
                r#type: ScriptType::Number,
                description: "Units of ironOre.",
                null_when: Some("when there are none"),
            },
            ScriptField {
                name: "iron",
                r#type: ScriptType::Number,
                description: "Units of iron.",
                null_when: Some("when there are none"),
            },
            ScriptField {
                name: "goldOre",
                r#type: ScriptType::Number,
                description: "Units of goldOre.",
                null_when: Some("when there are none"),
            },
            ScriptField {
                name: "coins",
                r#type: ScriptType::Number,
                description: "Units of coins.",
                null_when: Some("when there are none"),
            },
            ScriptField {
                name: "spear",
                r#type: ScriptType::Number,
                description: "Units of spear.",
                null_when: Some("when there are none"),
            },
            ScriptField {
                name: "sword",
                r#type: ScriptType::Number,
                description: "Units of sword.",
                null_when: Some("when there are none"),
            },
            ScriptField {
                name: "shield",
                r#type: ScriptType::Number,
                description: "Units of shield.",
                null_when: Some("when there are none"),
            },
            ScriptField {
                name: "armour",
                r#type: ScriptType::Number,
                description: "Units of armour.",
                null_when: Some("when there are none"),
            },
        ],
    },
    ScriptView {
        name: "queue",
        description: "A resident’s queue: steps done one after another. The current step’s order or script is the resident’s `order` or `script`.",
        fields: &[
            ScriptField {
                name: "step",
                r#type: ScriptType::Number,
                description: "The current step, counted from 1.",
                null_when: None,
            },
            ScriptField {
                name: "steps",
                r#type: ScriptType::Number,
                description: "How many steps it holds.",
                null_when: None,
            },
            ScriptField {
                name: "loop",
                r#type: ScriptType::Boolean,
                description: "Whether the first step follows the last.",
                null_when: None,
            },
            ScriptField {
                name: "kind",
                r#type: ScriptType::String,
                description: "The current step’s order: \"walkTo\", \"store\", \"task\", \"runScript\", ….",
                null_when: None,
            },
            ScriptField {
                name: "task",
                r#type: ScriptType::String,
                description: "The task the current step gives.",
                null_when: Some("unless it gives a task"),
            },
            ScriptField {
                name: "scriptId",
                r#type: ScriptType::Number,
                description: "The script the current step runs.",
                null_when: Some("unless it runs a script"),
            },
            ScriptField {
                name: "minutes",
                r#type: ScriptType::Number,
                description: "The current step’s duration in game minutes.",
                null_when: Some("when it has none"),
            },
            ScriptField {
                name: "startedAt",
                r#type: ScriptType::Number,
                description: "The tick the current step started.",
                null_when: Some("until it has"),
            },
        ],
    },
    ScriptView {
        name: "residentOrder",
        description: "A resident’s order, as plain data; which fields it has depends on its `kind`, the others are null.",
        fields: &[
            ScriptField {
                name: "kind",
                r#type: ScriptType::String,
                description: "The order: \"walkTo\", \"drive\", \"haul\", \"pickUp\", \"drop\", \"store\", \"fetch\", \"build\", \"tearDown\", \"workAt\", \"teach\", \"train\", \"breed\", \"attack\", \"climb\", \"roadLine\", \"wallLine\", \"pay\", \"buyCity\", \"trade\", \"swap\", \"buyHorse\", \"sellHorse\", \"handIn\", \"buyOff\", \"payDebt\", \"acceptOffer\" or \"relocate\" (on their way to `cityId`, to live there).",
                null_when: None,
            },
            ScriptField {
                name: "target",
                r#type: ScriptType::View("tile"),
                description: "Where a walk or drive goes, or the tile of the city’s area a relocation heads for.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "at",
                r#type: ScriptType::View("tile"),
                description: "The tile a build, work, tear-down, breeding or climb is on.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "progress",
                r#type: ScriptType::Number,
                description: "How far into the next step or piece of work; for breeding, the ticks tended so far.",
                null_when: Some("for orders that have none"),
            },
            ScriptField {
                name: "buildingId",
                r#type: ScriptType::String,
                description: "The building worked, taught or trained at, or torn down.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "subject",
                r#type: ScriptType::String,
                description: "The stat or skill taught.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "learning",
                r#type: ScriptType::String,
                description: "The stat or skill a trainee gained in on the last tick.",
                null_when: Some("while a trainee waits (no teacher, or at their ceiling), and for other orders"),
            },
            ScriptField {
                name: "building",
                r#type: ScriptType::String,
                description: "The kind of building being built.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "siteId",
                r#type: ScriptType::String,
                description: "The construction site being built.",
                null_when: Some("for other orders, and until it is laid out"),
            },
            ScriptField {
                name: "makes",
                r#type: ScriptType::String,
                description: "What a smithy is to make.",
                null_when: Some("for other orders, and at other workplaces"),
            },
            ScriptField {
                name: "carriageId",
                r#type: ScriptType::String,
                description: "The carriage driven, hauled with or traded from.",
                null_when: Some("for other orders, and when none"),
            },
            ScriptField {
                name: "stableId",
                r#type: ScriptType::String,
                description: "The stable horses are bred at.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "horseIds",
                r#type: ScriptType::List(&ScriptType::String),
                description: "The two horses being bred.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "targetId",
                r#type: ScriptType::String,
                description: "Who is attacked.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "wallId",
                r#type: ScriptType::String,
                description: "The wall or gate climbed.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "from",
                r#type: ScriptType::Any,
                description: "Where goods are picked up from (a spot), fetched from (a spot: a storage or carriage), or a haul’s first stop (a tile).",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "to",
                r#type: ScriptType::Any,
                description: "Where goods are dropped (a spot), stored (a spot: a storage or carriage), or a haul’s second stop (a tile).",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "goods",
                r#type: ScriptType::Any,
                description: "The goods picked up, dropped, stored or fetched, like {food: 3} (null units for a store or fetch of as many as there are), or the goods a haul takes to its second stop, as a list.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "returnGoods",
                r#type: ScriptType::List(&ScriptType::String),
                description: "The goods a haul brings back.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "keepFood",
                r#type: ScriptType::Number,
                description: "The Food a haul keeps on board for the horse.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "stop",
                r#type: ScriptType::String,
                description: "The haul stop a carriage is at or bound for: \"from\" or \"to\".",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "phase",
                r#type: ScriptType::String,
                description: "A haul’s \"loading\" or \"driving\", a road line’s \"walking\" or \"building\", a store’s \"walking\", \"putting\" or \"refilling\", a fetch’s \"walking\" or \"taking\".",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "tiles",
                r#type: ScriptType::List(&ScriptType::Any),
                description: "The road line’s tiles still to build, as [x, y] pairs.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "side",
                r#type: ScriptType::String,
                description: "A trade’s \"buy\" or \"sell\".",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "good",
                r#type: ScriptType::String,
                description: "The good traded or handed in.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "units",
                r#type: ScriptType::Number,
                description: "The units traded, wanted in a swap or handed in.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "give",
                r#type: ScriptType::String,
                description: "The good a swap gives.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "want",
                r#type: ScriptType::String,
                description: "The good a swap wants.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "cityId",
                r#type: ScriptType::String,
                description: "The city bought, a caravan trade’s city, or the city they relocate to.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "toCityId",
                r#type: ScriptType::String,
                description: "Where handed-in goods go.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "contractId",
                r#type: ScriptType::String,
                description: "The mercenary contract paid.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "weeks",
                r#type: ScriptType::Number,
                description: "The weeks paid.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "directiveId",
                r#type: ScriptType::String,
                description: "The directive bought off.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "army",
                r#type: ScriptType::String,
                description: "The army that gave this order.",
                null_when: Some("for an order of the resident’s own"),
            },
        ],
    },
    ScriptView {
        name: "armyOrder",
        description: "An army’s order; which fields it has depends on its `kind`, the others are null.",
        fields: &[
            ScriptField {
                name: "kind",
                r#type: ScriptType::String,
                description: "The order: \"walkTo\", \"attack\", \"guard\" or \"follow\".",
                null_when: None,
            },
            ScriptField {
                name: "target",
                r#type: ScriptType::View("tile"),
                description: "Where a walk goes.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "at",
                r#type: ScriptType::View("tile"),
                description: "Where it guards.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "targetId",
                r#type: ScriptType::String,
                description: "Who it attacks or follows.",
                null_when: Some("for other orders"),
            },
            ScriptField {
                name: "started",
                r#type: ScriptType::Boolean,
                description: "Whether its members got their orders yet.",
                null_when: None,
            },
        ],
    },
    ScriptView {
        name: "tile",
        description: "A tile.",
        fields: &[
            ScriptField {
                name: "x",
                r#type: ScriptType::Number,
                description: "From west to east.",
                null_when: None,
            },
            ScriptField {
                name: "y",
                r#type: ScriptType::Number,
                description: "From north to south.",
                null_when: None,
            },
        ],
    },
    ScriptView {
        name: "orderEnded",
        description: "How a resident’s last store, fetch or relocate order ended.",
        fields: &[
            ScriptField {
                name: "kind",
                r#type: ScriptType::String,
                description: "The order: \"store\", \"fetch\" or \"relocate\".",
                null_when: None,
            },
            ScriptField {
                name: "tick",
                r#type: ScriptType::Number,
                description: "The tick it ended.",
                null_when: None,
            },
            ScriptField {
                name: "reason",
                r#type: ScriptType::String,
                description: "Why it ended before it was done: \"no way\", \"the storage is gone\" or \"the carriage is gone\"; for a relocate, why they didn’t move in: \"no free housing\", \"it is no longer your realm’s\" or \"the city is gone\".",
                null_when: Some("when it was done (a relocating resident moved in)"),
            },
        ],
    },
    ScriptView {
        name: "pair",
        description: "A resident’s pair, to have a child.",
        fields: &[
            ScriptField {
                name: "partnerId",
                r#type: ScriptType::String,
                description: "Who they are paired with.",
                null_when: None,
            },
            ScriptField {
                name: "since",
                r#type: ScriptType::Number,
                description: "The tick they paired.",
                null_when: None,
            },
        ],
    },
    ScriptView {
        name: "carrying",
        description: "A child a resident carries.",
        fields: &[
            ScriptField {
                name: "since",
                r#type: ScriptType::Number,
                description: "The tick they started carrying it.",
                null_when: None,
            },
            ScriptField {
                name: "partnerId",
                r#type: ScriptType::String,
                description: "The other parent.",
                null_when: None,
            },
            ScriptField {
                name: "partnerName",
                r#type: ScriptType::String,
                description: "The other parent’s name.",
                null_when: None,
            },
            ScriptField {
                name: "partnerBase",
                r#type: ScriptType::Any,
                description: "The other parent’s base stats, like {strength: 5, …}.",
                null_when: None,
            },
        ],
    },
    ScriptView {
        name: "runningScript",
        description: "The script a resident runs.",
        fields: &[
            ScriptField {
                name: "scriptId",
                r#type: ScriptType::Number,
                description: "The script in its Player’s library; 0 while it runs a default without one.",
                null_when: None,
            },
            ScriptField {
                name: "memory",
                r#type: ScriptType::Any,
                description: "Its memory, to read but not change.",
                null_when: Some("for a resident of another Player"),
            },
        ],
    },
    ScriptView {
        name: "building",
        description: "A building or construction site, as the Player sees it.",
        fields: &[
            ScriptField {
                name: "id",
                r#type: ScriptType::String,
                description: "The building’s id, unique in the world.",
                null_when: None,
            },
            ScriptField {
                name: "kind",
                r#type: ScriptType::String,
                description: "What it is: \"townHall\", \"house\", \"storage\", \"warehouse\", \"wall\", \"gate\", \"farm\", \"stable\", \"mine\", \"quarry\", \"lumberCamp\", \"smelter\", \"mint\", \"smithy\", \"trainingGround\" or \"road\".",
                null_when: None,
            },
            ScriptField {
                name: "cityId",
                r#type: ScriptType::String,
                description: "The city it belongs to.",
                null_when: Some("for a building of no city, such as a workplace on a node"),
            },
            ScriptField {
                name: "realmId",
                r#type: ScriptType::String,
                description: "The realm an outpost storage, a storage of no city, belongs to; for a construction site, the realm whose resident laid it out.",
                null_when: Some("for any other building, for a storage of no city that belongs to no realm, and for a site no realm’s resident laid out"),
            },
            ScriptField {
                name: "x",
                r#type: ScriptType::Number,
                description: "The tile it stands on, from west to east.",
                null_when: None,
            },
            ScriptField {
                name: "y",
                r#type: ScriptType::Number,
                description: "The tile it stands on, from north to south.",
                null_when: None,
            },
            ScriptField {
                name: "stock",
                r#type: ScriptType::View("goods"),
                description: "The goods kept here; at a storage of my own, those not set aside for its offers, which I can’t take.",
                null_when: Some("for any building but a storage, warehouse or stable, and when the Player doesn’t see inside it"),
            },
            ScriptField {
                name: "site",
                r#type: ScriptType::View("site"),
                description: "How far it has come while it is a construction site.",
                null_when: Some("once it is finished"),
            },
            ScriptField {
                name: "teardown",
                r#type: ScriptType::Number,
                description: "Work put into tearing it down so far.",
                null_when: Some("until someone starts"),
            },
            ScriptField {
                name: "closed",
                r#type: ScriptType::Boolean,
                description: "true for a gate its realm has closed.",
                null_when: Some("for an open gate and any other building"),
            },
            ScriptField {
                name: "damage",
                r#type: ScriptType::Number,
                description: "Damage a wall or gate has taken from blows.",
                null_when: Some("until someone strikes it"),
            },
            ScriptField {
                name: "prices",
                r#type: ScriptType::List(&ScriptType::View("price")),
                description: "A Trade Org warehouse’s prices, one for each good it keeps.",
                null_when: Some("for any building but a Trade Org warehouse"),
            },
            ScriptField {
                name: "offers",
                r#type: ScriptType::List(&ScriptType::View("offer")),
                description: "The offers standing at a storage, oldest first; anyone in sight sees them.",
                null_when: Some("for any building but a storage with an offer"),
            },
            ScriptField {
                name: "teacher",
                r#type: ScriptType::String,
                description: "The resident teaching at a training ground.",
                null_when: Some("for any other building, and while nobody teaches there"),
            },
            ScriptField {
                name: "subject",
                r#type: ScriptType::String,
                description: "The stat or skill a training ground teaches: \"strength\", \"endurance\", \"agility\", \"intellect\" or a skill such as \"combat\".",
                null_when: Some("for any other building, and while nobody teaches there"),
            },
            ScriptField {
                name: "trainees",
                r#type: ScriptType::List(&ScriptType::String),
                description: "The residents training at a training ground; empty while nobody trains there.",
                null_when: Some("for any other building"),
            },
            ScriptField {
                name: "workSettings",
                r#type: ScriptType::View("workSettings"),
                description: "My realm’s Workplace settings for a workplace, or a construction site of a workplace kind, set on its card; never another realm’s.",
                null_when: Some("for any other building, and while my realm has set none there"),
            },
        ],
    },
    ScriptView {
        name: "workSettings",
        description: "How my realm has a workplace worked (Workplace settings).",
        fields: &[
            ScriptField {
                name: "scriptId",
                r#type: ScriptType::Number,
                description: "The work script: one of my Player’s scripts declaring `param workplace: building`.",
                null_when: Some("for the Work default"),
            },
            ScriptField {
                name: "params",
                r#type: ScriptType::Any,
                description: "Values set for the work script’s params, by name: a building’s or carriage’s id, or a number, like {storage: \"b12\", foodTake: 5}; a param not set is left out.",
                null_when: None,
            },
        ],
    },
    ScriptView {
        name: "site",
        description: "How far a construction site has come.",
        fields: &[
            ScriptField {
                name: "delivered",
                r#type: ScriptType::View("goods"),
                description: "Materials delivered so far.",
                null_when: None,
            },
            ScriptField {
                name: "work",
                r#type: ScriptType::Number,
                description: "Work put in so far.",
                null_when: None,
            },
        ],
    },
    ScriptView {
        name: "price",
        description: "A price for one good, at a Trade Org warehouse, an NPC city or a wandering trader.",
        fields: &[
            ScriptField {
                name: "good",
                r#type: ScriptType::String,
                description: "The good.",
                null_when: None,
            },
            ScriptField {
                name: "buy",
                r#type: ScriptType::Number,
                description: "What it pays for one unit.",
                null_when: None,
            },
            ScriptField {
                name: "sell",
                r#type: ScriptType::Number,
                description: "What it asks for one unit.",
                null_when: None,
            },
            ScriptField {
                name: "stock",
                r#type: ScriptType::Number,
                description: "What it holds.",
                null_when: Some("unless the Player sees inside"),
            },
            ScriptField {
                name: "forSale",
                r#type: ScriptType::Number,
                description: "Units an NPC city would sell.",
                null_when: Some("but at an NPC city"),
            },
            ScriptField {
                name: "wanted",
                r#type: ScriptType::Number,
                description: "Units an NPC city would buy.",
                null_when: Some("but at an NPC city"),
            },
        ],
    },
    ScriptView {
        name: "trader",
        description: "A wandering trader of the Trade Organization, as the Player sees it.",
        fields: &[
            ScriptField {
                name: "id",
                r#type: ScriptType::String,
                description: "The trader’s id, unique in the world.",
                null_when: None,
            },
            ScriptField {
                name: "carriageId",
                r#type: ScriptType::String,
                description: "Its carriage.",
                null_when: None,
            },
            ScriptField {
                name: "driverId",
                r#type: ScriptType::String,
                description: "The resident who drives it.",
                null_when: Some("with no crew left"),
            },
            ScriptField {
                name: "escortIds",
                r#type: ScriptType::List(&ScriptType::String),
                description: "The residents who walk along with it.",
                null_when: None,
            },
            ScriptField {
                name: "postId",
                r#type: ScriptType::String,
                description: "The trading post it goes to next.",
                null_when: Some("with no post left"),
            },
            ScriptField {
                name: "heading",
                r#type: ScriptType::String,
                description: "Where it is bound: \"hq\" or \"post\".",
                null_when: None,
            },
            ScriptField {
                name: "standing",
                r#type: ScriptType::View("traderStand"),
                description: "Where it stands to trade.",
                null_when: Some("unless it stands at a stop"),
            },
            ScriptField {
                name: "prices",
                r#type: ScriptType::List(&ScriptType::View("price")),
                description: "Its prices, one for each good, from what it carries.",
                null_when: Some("unless it stands at a stop"),
            },
        ],
    },
    ScriptView {
        name: "traderStand",
        description: "Where a wandering trader stands to trade: anyone on its tile can.",
        fields: &[
            ScriptField {
                name: "cityId",
                r#type: ScriptType::String,
                description: "The city it stands at.",
                null_when: None,
            },
            ScriptField {
                name: "x",
                r#type: ScriptType::Number,
                description: "The tile it stands on, from west to east.",
                null_when: None,
            },
            ScriptField {
                name: "y",
                r#type: ScriptType::Number,
                description: "The tile it stands on, from north to south.",
                null_when: None,
            },
            ScriptField {
                name: "until",
                r#type: ScriptType::Number,
                description: "The tick it goes on.",
                null_when: None,
            },
        ],
    },
    ScriptView {
        name: "offer",
        description: "What a Player posts at a storage of their realm: \"gives 10 Wood, wants 5 Stone\", some times over.",
        fields: &[
            ScriptField {
                name: "id",
                r#type: ScriptType::String,
                description: "The offer’s id, unique in the world.",
                null_when: None,
            },
            ScriptField {
                name: "realmId",
                r#type: ScriptType::String,
                description: "The realm that posted it.",
                null_when: None,
            },
            ScriptField {
                name: "storageId",
                r#type: ScriptType::String,
                description: "The storage it stands at; accept it on its tile.",
                null_when: None,
            },
            ScriptField {
                name: "x",
                r#type: ScriptType::Number,
                description: "The tile it stands on, from west to east.",
                null_when: None,
            },
            ScriptField {
                name: "y",
                r#type: ScriptType::Number,
                description: "The tile it stands on, from north to south.",
                null_when: None,
            },
            ScriptField {
                name: "gives",
                r#type: ScriptType::String,
                description: "The good it gives; may be \"coins\".",
                null_when: None,
            },
            ScriptField {
                name: "givesUnits",
                r#type: ScriptType::Number,
                description: "How much of it each time.",
                null_when: None,
            },
            ScriptField {
                name: "wants",
                r#type: ScriptType::String,
                description: "The good it wants; may be \"coins\".",
                null_when: None,
            },
            ScriptField {
                name: "wantsUnits",
                r#type: ScriptType::Number,
                description: "How much of it each time: 0 for goods set aside on accepting a demand, which want nothing back.",
                null_when: None,
            },
            ScriptField {
                name: "times",
                r#type: ScriptType::Number,
                description: "How many more times it can be accepted.",
                null_when: None,
            },
            ScriptField {
                name: "rate",
                r#type: ScriptType::Number,
                description: "What it wants for one unit it gives.",
                null_when: None,
            },
            ScriptField {
                name: "direct",
                r#type: ScriptType::View("directOffer"),
                description: "Who it was sent to, when it is a direct offer.",
                null_when: Some("for an offer to anyone"),
            },
        ],
    },
    ScriptView {
        name: "directOffer",
        description: "What makes an offer a direct one: only one realm can accept it, for a set time.",
        fields: &[
            ScriptField {
                name: "toId",
                r#type: ScriptType::String,
                description: "The realm it was sent to, the only one who can accept it.",
                null_when: None,
            },
            ScriptField {
                name: "lapsesAt",
                r#type: ScriptType::Number,
                description: "The tick it lapses at, its goods then ordinary again.",
                null_when: None,
            },
            ScriptField {
                name: "carried",
                r#type: ScriptType::View("carriedOffer"),
                description: "How the Trade Organization carries it, when it does.",
                null_when: Some("for one fetched in person"),
            },
        ],
    },
    ScriptView {
        name: "carriedOffer",
        description: "A direct offer the Trade Organization carries as two Transfers once accepted, nothing set aside.",
        fields: &[
            ScriptField {
                name: "fromCityId",
                r#type: ScriptType::String,
                description: "The sender’s city, where its goods are picked up.",
                null_when: None,
            },
            ScriptField {
                name: "toCityId",
                r#type: ScriptType::String,
                description: "The other side’s city, where theirs are picked up.",
                null_when: None,
            },
            ScriptField {
                name: "feeBy",
                r#type: ScriptType::String,
                description: "Who pays the fee: \"sender\" or \"split\".",
                null_when: None,
            },
            ScriptField {
                name: "senderFee",
                r#type: ScriptType::Number,
                description: "What the sender pays when all of its goods are taken.",
                null_when: None,
            },
            ScriptField {
                name: "otherFee",
                r#type: ScriptType::Number,
                description: "What the other side pays when all of its goods are taken.",
                null_when: None,
            },
        ],
    },
    ScriptView {
        name: "city",
        description: "A city, as the Player sees it.",
        fields: &[
            ScriptField {
                name: "id",
                r#type: ScriptType::String,
                description: "The city’s id, unique in the world.",
                null_when: None,
            },
            ScriptField {
                name: "name",
                r#type: ScriptType::String,
                description: "The city’s name, as the Player knows it.",
                null_when: None,
            },
            ScriptField {
                name: "realmId",
                r#type: ScriptType::String,
                description: "The realm it belongs to.",
                null_when: Some("for an NPC city"),
            },
            ScriptField {
                name: "townHallId",
                r#type: ScriptType::String,
                description: "Its town hall, which makes it a city.",
                null_when: None,
            },
            ScriptField {
                name: "tradeOrg",
                r#type: ScriptType::String,
                description: "\"hq\" or \"post\" for a city of the Trade Organization.",
                null_when: Some("for any other city"),
            },
            ScriptField {
                name: "price",
                r#type: ScriptType::Number,
                description: "The Coins an NPC city asks the Player to buy it.",
                null_when: Some("for a realm’s city, and an NPC city that won’t sell"),
            },
            ScriptField {
                name: "wontSell",
                r#type: ScriptType::Boolean,
                description: "true when an NPC city holds the Player in too low standing to sell.",
                null_when: Some("otherwise"),
            },
            ScriptField {
                name: "refuses",
                r#type: ScriptType::Boolean,
                description: "true when an NPC city won’t trade with the Player, hire out to them or let their residents through its gates.",
                null_when: Some("otherwise"),
            },
            ScriptField {
                name: "hire",
                r#type: ScriptType::View("hire"),
                description: "What an NPC city would lend the Player.",
                null_when: Some("for a realm’s city, and an NPC city that refuses them"),
            },
            ScriptField {
                name: "trade",
                r#type: ScriptType::List(&ScriptType::View("price")),
                description: "An NPC city’s prices to the Player, one for each good.",
                null_when: Some("unless a storage of the NPC city is in sight"),
            },
            ScriptField {
                name: "horses",
                r#type: ScriptType::List(&ScriptType::View("horseOffer")),
                description: "The horses in sight standing in an NPC city’s finished stables, with what it asks for each.",
                null_when: Some("unless a stable of the NPC city with a horse is in sight"),
            },
            ScriptField {
                name: "horsesToSell",
                r#type: ScriptType::List(&ScriptType::View("horseOffer")),
                description: "The Player’s horses in sight standing in an NPC city’s finished stables, with what it pays for each.",
                null_when: Some("unless a stable of the NPC city with a horse of the Player’s is in sight"),
            },
            ScriptField {
                name: "occupation",
                r#type: ScriptType::View("occupation"),
                description: "Who occupies its town hall and how long is left before the city is captured.",
                null_when: Some("unless its town hall is occupied and in sight"),
            },
        ],
    },
    ScriptView {
        name: "occupation",
        description: "A realm occupying a city’s town hall.",
        fields: &[
            ScriptField {
                name: "realmId",
                r#type: ScriptType::String,
                description: "The realm occupying it.",
                null_when: None,
            },
            ScriptField {
                name: "ticksLeft",
                r#type: ScriptType::Number,
                description: "Ticks it has to hold the town hall to capture the city.",
                null_when: None,
            },
        ],
    },
    ScriptView {
        name: "alarm",
        description: "Something that happened in a City area, that an Alarm script runs for.",
        fields: &[
            ScriptField {
                name: "kind",
                r#type: ScriptType::String,
                description: "What happened: \"occupied\", the city’s town hall occupied; \"outsider\", someone of another realm, not allied, came into its area; \"theft\", someone stealing from the realm; \"attacked\", a wall or gate of the city or a resident of the realm struck.",
                null_when: None,
            },
            ScriptField {
                name: "cityId",
                r#type: ScriptType::String,
                description: "The city whose area it happened in.",
                null_when: None,
            },
            ScriptField {
                name: "about",
                r#type: ScriptType::String,
                description: "The id of the resident it is about: an occupier on the hall, the outsider who came, the thief, or the attacker.",
                null_when: None,
            },
            ScriptField {
                name: "realmId",
                r#type: ScriptType::String,
                description: "The realm of who it is about.",
                null_when: Some("when they belong to no realm"),
            },
            ScriptField {
                name: "x",
                r#type: ScriptType::Number,
                description: "Where it happened, from west to east: the town hall, where the outsider stood, where the thief took it, or what was struck.",
                null_when: None,
            },
            ScriptField {
                name: "y",
                r#type: ScriptType::Number,
                description: "Where it happened, from north to south: the town hall, where the outsider stood, where the thief took it, or what was struck.",
                null_when: None,
            },
            ScriptField {
                name: "tick",
                r#type: ScriptType::Number,
                description: "The tick it happened.",
                null_when: None,
            },
        ],
    },
    ScriptView {
        name: "hire",
        description: "What an NPC city would lend.",
        fields: &[
            ScriptField {
                name: "spare",
                r#type: ScriptType::Number,
                description: "How many residents it would lend.",
                null_when: None,
            },
            ScriptField {
                name: "pricePerResidentWeek",
                r#type: ScriptType::Number,
                description: "What it asks for each a week, in Coins.",
                null_when: None,
            },
        ],
    },
    ScriptView {
        name: "horseOffer",
        description: "A horse in an NPC city’s stable with a price on it, as its Trade section lists it: its own to buy, or the Player’s to sell.",
        fields: &[
            ScriptField {
                name: "horseId",
                r#type: ScriptType::String,
                description: "The horse’s id.",
                null_when: None,
            },
            ScriptField {
                name: "stableId",
                r#type: ScriptType::String,
                description: "The id of the stable it stands in.",
                null_when: None,
            },
            ScriptField {
                name: "name",
                r#type: ScriptType::String,
                description: "Its name.",
                null_when: None,
            },
            ScriptField {
                name: "stats",
                r#type: ScriptType::View("horseStats"),
                description: "Its Speed, Strength and Endurance.",
                null_when: None,
            },
            ScriptField {
                name: "bornAt",
                r#type: ScriptType::Number,
                description: "The tick it was born.",
                null_when: None,
            },
            ScriptField {
                name: "price",
                r#type: ScriptType::Number,
                description: "What the city asks of the Player for it, or pays, in Coins.",
                null_when: None,
            },
            ScriptField {
                name: "problem",
                r#type: ScriptType::String,
                description: "Why the city won’t trade it with the Player, whoever goes there.",
                null_when: Some("when it would"),
            },
        ],
    },
    ScriptView {
        name: "horse",
        description: "A horse, as the Player sees it.",
        fields: &[
            ScriptField {
                name: "id",
                r#type: ScriptType::String,
                description: "The horse’s id, unique in the world.",
                null_when: None,
            },
            ScriptField {
                name: "name",
                r#type: ScriptType::String,
                description: "Its name, given by the game or its Player.",
                null_when: None,
            },
            ScriptField {
                name: "realmId",
                r#type: ScriptType::String,
                description: "The realm it belongs to.",
                null_when: Some("for one of an NPC city or of nobody"),
            },
            ScriptField {
                name: "cityId",
                r#type: ScriptType::String,
                description: "The NPC city it belongs to.",
                null_when: Some("for one of a realm or of nobody"),
            },
            ScriptField {
                name: "x",
                r#type: ScriptType::Number,
                description: "The tile it stands on, from west to east.",
                null_when: None,
            },
            ScriptField {
                name: "y",
                r#type: ScriptType::Number,
                description: "The tile it stands on, from north to south.",
                null_when: None,
            },
            ScriptField {
                name: "hunger",
                r#type: ScriptType::Number,
                description: "Fully fed is 100, empty 0.",
                null_when: Some("for one of another realm that isn’t allied"),
            },
            ScriptField {
                name: "health",
                r#type: ScriptType::Number,
                description: "0 is dead; full is 100.",
                null_when: Some("for one of another realm that isn’t allied"),
            },
            ScriptField {
                name: "down",
                r#type: ScriptType::Boolean,
                description: "Whether it is Down: lying unconscious from hunger until it eats Food in reach.",
                null_when: None,
            },
            ScriptField {
                name: "downUntil",
                r#type: ScriptType::Number,
                description: "The tick at which it dies of hunger unless it eats first.",
                null_when: Some("unless it is Down, and for one of another realm that isn’t allied"),
            },
            ScriptField {
                name: "stats",
                r#type: ScriptType::View("horseStats"),
                description: "Speed, strength and endurance.",
                null_when: None,
            },
            ScriptField {
                name: "bornAt",
                r#type: ScriptType::Number,
                description: "The tick it was born; may be before the world began.",
                null_when: None,
            },
        ],
    },
    ScriptView {
        name: "horseStats",
        description: "A horse’s stats, whole numbers it was born with.",
        fields: &[
            ScriptField {
                name: "speed",
                r#type: ScriptType::Number,
                description: "Its speed.",
                null_when: None,
            },
            ScriptField {
                name: "strength",
                r#type: ScriptType::Number,
                description: "Its strength.",
                null_when: None,
            },
            ScriptField {
                name: "endurance",
                r#type: ScriptType::Number,
                description: "Its endurance.",
                null_when: None,
            },
        ],
    },
    ScriptView {
        name: "carriage",
        description: "A carriage, as the Player sees it.",
        fields: &[
            ScriptField {
                name: "id",
                r#type: ScriptType::String,
                description: "The carriage’s id, unique in the world.",
                null_when: None,
            },
            ScriptField {
                name: "realmId",
                r#type: ScriptType::String,
                description: "The realm it belongs to.",
                null_when: Some("for one of an NPC city or of nobody"),
            },
            ScriptField {
                name: "cityId",
                r#type: ScriptType::String,
                description: "The NPC city it belongs to.",
                null_when: Some("for one of a realm or of nobody"),
            },
            ScriptField {
                name: "x",
                r#type: ScriptType::Number,
                description: "The tile it stands on, from west to east.",
                null_when: None,
            },
            ScriptField {
                name: "y",
                r#type: ScriptType::Number,
                description: "The tile it stands on, from north to south.",
                null_when: None,
            },
            ScriptField {
                name: "horseId",
                r#type: ScriptType::String,
                description: "The horse hitched to it.",
                null_when: Some("when none is"),
            },
            ScriptField {
                name: "passengerIds",
                r#type: ScriptType::List(&ScriptType::String),
                description: "The residents aboard it as passengers.",
                null_when: None,
            },
            ScriptField {
                name: "standsStill",
                r#type: ScriptType::Boolean,
                description: "Whether it stands still with nothing to move it: no driver driving it, or its horse Down or dead.",
                null_when: None,
            },
            ScriptField {
                name: "load",
                r#type: ScriptType::View("goods"),
                description: "The goods on board.",
                null_when: Some("unless the Player sees inside"),
            },
            ScriptField {
                name: "loadLevel",
                r#type: ScriptType::String,
                description: "How heavily it looks loaded: \"empty\", \"light\", \"half\", \"heavy\" or \"full\".",
                null_when: None,
            },
        ],
    },
    ScriptView {
        name: "vessel",
        description: "A boat on the water, as the Player sees it.",
        fields: &[
            ScriptField {
                name: "id",
                r#type: ScriptType::String,
                description: "The vessel’s id, unique in the world.",
                null_when: None,
            },
            ScriptField {
                name: "kind",
                r#type: ScriptType::String,
                description: "What it is: \"boat\".",
                null_when: None,
            },
            ScriptField {
                name: "realmId",
                r#type: ScriptType::String,
                description: "The realm it belongs to.",
                null_when: Some("for one of nobody"),
            },
            ScriptField {
                name: "x",
                r#type: ScriptType::Number,
                description: "The water tile it floats on, from west to east.",
                null_when: None,
            },
            ScriptField {
                name: "y",
                r#type: ScriptType::Number,
                description: "The water tile it floats on, from north to south.",
                null_when: None,
            },
            ScriptField {
                name: "load",
                r#type: ScriptType::View("goods"),
                description: "The goods on board.",
                null_when: Some("unless the Player sees inside"),
            },
            ScriptField {
                name: "loadLevel",
                r#type: ScriptType::String,
                description: "How heavily it looks loaded: \"empty\", \"light\", \"half\", \"heavy\" or \"full\".",
                null_when: None,
            },
        ],
    },
    ScriptView {
        name: "pile",
        description: "Goods lying on a tile.",
        fields: &[
            ScriptField {
                name: "id",
                r#type: ScriptType::String,
                description: "The pile’s id, unique in the world.",
                null_when: None,
            },
            ScriptField {
                name: "x",
                r#type: ScriptType::Number,
                description: "The tile it stands on, from west to east.",
                null_when: None,
            },
            ScriptField {
                name: "y",
                r#type: ScriptType::Number,
                description: "The tile it stands on, from north to south.",
                null_when: None,
            },
            ScriptField {
                name: "goods",
                r#type: ScriptType::View("goods"),
                description: "The goods lying there.",
                null_when: None,
            },
        ],
    },
    ScriptView {
        name: "node",
        description: "A resource node.",
        fields: &[
            ScriptField {
                name: "id",
                r#type: ScriptType::String,
                description: "The node’s id, unique in the world.",
                null_when: None,
            },
            ScriptField {
                name: "kind",
                r#type: ScriptType::String,
                description: "What it yields: \"forest\", \"stone\", \"ironOre\" or \"goldOre\".",
                null_when: None,
            },
            ScriptField {
                name: "x",
                r#type: ScriptType::Number,
                description: "The tile it stands on, from west to east.",
                null_when: None,
            },
            ScriptField {
                name: "y",
                r#type: ScriptType::Number,
                description: "The tile it stands on, from north to south.",
                null_when: None,
            },
        ],
    },
    ScriptView {
        name: "lastSeen",
        description: "A building, construction site or city the Player has seen and that is out of their sight now, as they last saw it.",
        fields: &[
            ScriptField {
                name: "is",
                r#type: ScriptType::String,
                description: "\"building\" or \"city\".",
                null_when: None,
            },
            ScriptField {
                name: "seenAt",
                r#type: ScriptType::Number,
                description: "The tick it was last in sight.",
                null_when: None,
            },
            ScriptField {
                name: "id",
                r#type: ScriptType::String,
                description: "The building or city’s id, unique in the world.",
                null_when: None,
            },
            ScriptField {
                name: "kind",
                r#type: ScriptType::String,
                description: "What it is: \"townHall\", \"house\", \"storage\", \"warehouse\", \"wall\", \"gate\", \"farm\", \"stable\", \"mine\", \"quarry\", \"lumberCamp\", \"smelter\", \"mint\", \"smithy\", \"trainingGround\" or \"road\".",
                null_when: Some("for a city"),
            },
            ScriptField {
                name: "cityId",
                r#type: ScriptType::String,
                description: "The city it belongs to.",
                null_when: Some("for a city, for a building of no city, such as a workplace on a node"),
            },
            ScriptField {
                name: "x",
                r#type: ScriptType::Number,
                description: "The tile it stands on, from west to east.",
                null_when: Some("for a city"),
            },
            ScriptField {
                name: "y",
                r#type: ScriptType::Number,
                description: "The tile it stands on, from north to south.",
                null_when: Some("for a city"),
            },
            ScriptField {
                name: "stock",
                r#type: ScriptType::View("goods"),
                description: "The goods kept here; at a storage of my own, those not set aside for its offers, which I can’t take.",
                null_when: Some("for a city, for any building but a storage, warehouse or stable, and when the Player doesn’t see inside it"),
            },
            ScriptField {
                name: "site",
                r#type: ScriptType::View("site"),
                description: "How far it has come while it is a construction site.",
                null_when: Some("for a city, once it is finished"),
            },
            ScriptField {
                name: "teardown",
                r#type: ScriptType::Number,
                description: "Work put into tearing it down so far.",
                null_when: Some("for a city, until someone starts"),
            },
            ScriptField {
                name: "closed",
                r#type: ScriptType::Boolean,
                description: "true for a gate its realm has closed.",
                null_when: Some("for a city, for an open gate and any other building"),
            },
            ScriptField {
                name: "damage",
                r#type: ScriptType::Number,
                description: "Damage a wall or gate has taken from blows.",
                null_when: Some("for a city, until someone strikes it"),
            },
            ScriptField {
                name: "prices",
                r#type: ScriptType::List(&ScriptType::View("price")),
                description: "A Trade Org warehouse’s prices, one for each good it keeps.",
                null_when: Some("for a city, for any building but a Trade Org warehouse"),
            },
            ScriptField {
                name: "offers",
                r#type: ScriptType::List(&ScriptType::View("offer")),
                description: "The offers standing at a storage, oldest first; anyone in sight sees them.",
                null_when: Some("for a city, for any building but a storage with an offer"),
            },
            ScriptField {
                name: "name",
                r#type: ScriptType::String,
                description: "The city’s name, as the Player knows it.",
                null_when: Some("for a building"),
            },
            ScriptField {
                name: "realmId",
                r#type: ScriptType::String,
                description: "The realm a city, an outpost storage (a storage of no city) or a construction site belongs to.",
                null_when: Some("for an NPC city, and for any other building"),
            },
            ScriptField {
                name: "townHallId",
                r#type: ScriptType::String,
                description: "Its town hall, which makes it a city.",
                null_when: Some("for a building"),
            },
            ScriptField {
                name: "tradeOrg",
                r#type: ScriptType::String,
                description: "\"hq\" or \"post\" for a city of the Trade Organization.",
                null_when: Some("for a building, for any other city"),
            },
            ScriptField {
                name: "price",
                r#type: ScriptType::Number,
                description: "The Coins an NPC city asks the Player to buy it.",
                null_when: Some("for a building, for a realm’s city, and an NPC city that won’t sell"),
            },
            ScriptField {
                name: "wontSell",
                r#type: ScriptType::Boolean,
                description: "true when an NPC city holds the Player in too low standing to sell.",
                null_when: Some("for a building, otherwise"),
            },
            ScriptField {
                name: "refuses",
                r#type: ScriptType::Boolean,
                description: "true when an NPC city won’t trade with the Player, hire out to them or let their residents through its gates.",
                null_when: Some("for a building, otherwise"),
            },
            ScriptField {
                name: "hire",
                r#type: ScriptType::View("hire"),
                description: "What an NPC city would lend the Player.",
                null_when: Some("for a building, for a realm’s city, and an NPC city that refuses them"),
            },
            ScriptField {
                name: "trade",
                r#type: ScriptType::List(&ScriptType::View("price")),
                description: "An NPC city’s prices to the Player, one for each good.",
                null_when: Some("for a building, unless a storage of the NPC city is in sight"),
            },
            ScriptField {
                name: "horses",
                r#type: ScriptType::List(&ScriptType::View("horseOffer")),
                description: "The horses in sight standing in an NPC city’s finished stables, with what it asks for each.",
                null_when: Some("for a building, unless a stable of the NPC city with a horse is in sight"),
            },
            ScriptField {
                name: "horsesToSell",
                r#type: ScriptType::List(&ScriptType::View("horseOffer")),
                description: "The Player’s horses in sight standing in an NPC city’s finished stables, with what it pays for each.",
                null_when: Some("for a building, unless a stable of the NPC city with a horse of the Player’s is in sight"),
            },
            ScriptField {
                name: "occupation",
                r#type: ScriptType::View("occupation"),
                description: "Who occupies its town hall and how long is left before the city is captured.",
                null_when: Some("for a building, unless its town hall is occupied and in sight"),
            },
        ],
    },
    ScriptView {
        name: "directive",
        description: "An admin directive in force.",
        fields: &[
            ScriptField {
                name: "id",
                r#type: ScriptType::String,
                description: "The directive’s id, unique in the world.",
                null_when: None,
            },
            ScriptField {
                name: "target",
                r#type: ScriptType::String,
                description: "The realm or NPC city it names.",
                null_when: None,
            },
            ScriptField {
                name: "targetName",
                r#type: ScriptType::String,
                description: "The target’s name.",
                null_when: None,
            },
            ScriptField {
                name: "withAlliance",
                r#type: ScriptType::Boolean,
                description: "Whether it names the target’s alliance too.",
                null_when: None,
            },
            ScriptField {
                name: "reason",
                r#type: ScriptType::String,
                description: "Why it was given.",
                null_when: None,
            },
            ScriptField {
                name: "givenAt",
                r#type: ScriptType::Number,
                description: "The tick it was given.",
                null_when: None,
            },
            ScriptField {
                name: "goals",
                r#type: ScriptType::List(&ScriptType::View("directiveGoal")),
                description: "What ends it.",
                null_when: None,
            },
            ScriptField {
                name: "price",
                r#type: ScriptType::Number,
                description: "The Coins the target can pay to buy it off.",
                null_when: Some("when it can’t be bought off"),
            },
        ],
    },
    ScriptView {
        name: "directiveGoal",
        description: "A goal of an admin directive.",
        fields: &[
            ScriptField {
                name: "kind",
                r#type: ScriptType::String,
                description: "\"city\" or \"soldiers\".",
                null_when: None,
            },
            ScriptField {
                name: "city",
                r#type: ScriptType::String,
                description: "The city to destroy, by its name when the goal was set.",
                null_when: Some("for a soldiers goal"),
            },
            ScriptField {
                name: "count",
                r#type: ScriptType::Number,
                description: "Soldiers to kill.",
                null_when: Some("for a city goal"),
            },
            ScriptField {
                name: "percent",
                r#type: ScriptType::Number,
                description: "The share of its soldiers the count was set as.",
                null_when: Some("unless it was set as a share"),
            },
        ],
    },
    ScriptView {
        name: "material",
        description: "Materials a construction site still lacks.",
        fields: &[
            ScriptField {
                name: "good",
                r#type: ScriptType::String,
                description: "The good.",
                null_when: None,
            },
            ScriptField {
                name: "units",
                r#type: ScriptType::Number,
                description: "How many units it lacks.",
                null_when: None,
            },
        ],
    },
    ScriptView {
        name: "lineTile",
        description: "A tile of a Build line still to build.",
        fields: &[
            ScriptField {
                name: "x",
                r#type: ScriptType::Number,
                description: "From west to east.",
                null_when: None,
            },
            ScriptField {
                name: "y",
                r#type: ScriptType::Number,
                description: "From north to south.",
                null_when: None,
            },
            ScriptField {
                name: "siteId",
                r#type: ScriptType::String,
                description: "The construction site of the line’s road or wall on it.",
                null_when: Some("while none is laid out there"),
            },
        ],
    },
    ScriptView {
        name: "waypoint",
        description: "One of the Player’s waypoints: a named marker on a tile that only they see.",
        fields: &[
            ScriptField {
                name: "id",
                r#type: ScriptType::String,
                description: "The waypoint’s id, unique in the world.",
                null_when: None,
            },
            ScriptField {
                name: "name",
                r#type: ScriptType::String,
                description: "Its name; others may have the same.",
                null_when: None,
            },
            ScriptField {
                name: "x",
                r#type: ScriptType::Number,
                description: "From west to east.",
                null_when: None,
            },
            ScriptField {
                name: "y",
                r#type: ScriptType::Number,
                description: "From north to south.",
                null_when: None,
            },
        ],
    },
    ScriptView {
        name: "demand",
        description: "A demand my realm sent or was sent, waiting for an answer (`sendDemand`, `acceptDemand`, `declineDemand`).",
        fields: &[
            ScriptField {
                name: "id",
                r#type: ScriptType::String,
                description: "The demand’s id, unique in the world.",
                null_when: None,
            },
            ScriptField {
                name: "fromId",
                r#type: ScriptType::String,
                description: "The realm that sent it.",
                null_when: None,
            },
            ScriptField {
                name: "from",
                r#type: ScriptType::String,
                description: "That realm’s name.",
                null_when: None,
            },
            ScriptField {
                name: "toId",
                r#type: ScriptType::String,
                description: "The realm it was sent to, the only one who can answer it.",
                null_when: None,
            },
            ScriptField {
                name: "to",
                r#type: ScriptType::String,
                description: "That realm’s name.",
                null_when: None,
            },
            ScriptField {
                name: "terms",
                r#type: ScriptType::Any,
                description: "What it asks for: `{ kind: \"city\", cityId, cityName }` or `{ kind: \"goods\", goods }`.",
                null_when: None,
            },
            ScriptField {
                name: "note",
                r#type: ScriptType::String,
                description: "The sender’s words, as plain text.",
                null_when: None,
            },
            ScriptField {
                name: "sentAt",
                r#type: ScriptType::Number,
                description: "The tick it was sent.",
                null_when: None,
            },
            ScriptField {
                name: "deadline",
                r#type: ScriptType::Number,
                description: "The tick it lapses at, unanswered.",
                null_when: None,
            },
        ],
    },
];

/// The breaking changes to the script views so far, oldest first (`SCRIPT_VIEW_CHANGES`).
pub static SCRIPT_VIEW_CHANGES: &[ViewChange] = &[ViewChange::Undeclared];

/// The game API of a resident's script (`SCRIPT_API`).
pub static SCRIPT_API: &[ScriptBinding] = &[
    ScriptBinding {
        name: "me",
        is: Is::Value,
        params: &[],
        cost: 0.0,
        description: "The resident running the script, as the Player sees them, with their `age`.",
        returns: ScriptType::View("resident"),
    },
    ScriptBinding {
        name: "memory",
        is: Is::Value,
        params: &[],
        cost: 0.0,
        description: "An object kept between ticks for whoever runs it; whatever is set on it stays.",
        returns: ScriptType::Any,
    },
    ScriptBinding {
        name: "params",
        is: Is::Value,
        params: &[],
        cost: 0.0,
        description: "The values of the script’s `param` lines, picked on the resident card for whoever runs it: `params.name` for `param name: type`; a `number` param’s default (`param name: number = 3`) while none is set, else null.",
        returns: ScriptType::Any,
    },
    ScriptBinding {
        name: "debt",
        is: Is::Value,
        params: &[],
        cost: 0.0,
        description: "The Coins my realm owes the Trade Organization, 0 when it owes nothing: what its army came for and couldn’t take, and what crimes cost it since.",
        returns: ScriptType::Number,
    },
    ScriptBinding {
        name: "tick",
        is: Is::Value,
        params: &[],
        cost: 0.0,
        description: "The world tick this run is for.",
        returns: ScriptType::Number,
    },
    ScriptBinding {
        name: "mapSize",
        is: Is::Value,
        params: &[],
        cost: 0.0,
        description: "Tiles along each side of the map; its opposite sides join.",
        returns: ScriptType::Number,
    },
    ScriptBinding {
        name: "random",
        is: Is::Value,
        params: &[],
        cost: 0.0,
        description: "A number from 0 up to 1, drawn anew each tick and the same for every script that tick, so residents can agree on a random pick.",
        returns: ScriptType::Number,
    },
    ScriptBinding {
        name: "residents",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The residents the Player sees, their own included; those of their own running a script with its `script.memory`, to read but not change.",
        returns: ScriptType::List(&ScriptType::View("resident")),
    },
    ScriptBinding {
        name: "buildings",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The buildings and construction sites the Player sees, roads included.",
        returns: ScriptType::List(&ScriptType::View("building")),
    },
    ScriptBinding {
        name: "cities",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The cities the Player sees any of.",
        returns: ScriptType::List(&ScriptType::View("city")),
    },
    ScriptBinding {
        name: "horses",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The horses the Player sees.",
        returns: ScriptType::List(&ScriptType::View("horse")),
    },
    ScriptBinding {
        name: "carriages",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The carriages the Player sees.",
        returns: ScriptType::List(&ScriptType::View("carriage")),
    },
    ScriptBinding {
        name: "vessels",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The boats the Player sees on the water.",
        returns: ScriptType::List(&ScriptType::View("vessel")),
    },
    ScriptBinding {
        name: "traders",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The wandering traders the Player sees: those standing at a stop name where and their prices.",
        returns: ScriptType::List(&ScriptType::View("trader")),
    },
    ScriptBinding {
        name: "piles",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The piles of goods the Player sees.",
        returns: ScriptType::List(&ScriptType::View("pile")),
    },
    ScriptBinding {
        name: "nodes",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The resource nodes on terrain the Player has explored.",
        returns: ScriptType::List(&ScriptType::View("node")),
    },
    ScriptBinding {
        name: "nodesInSight",
        is: Is::Query,
        params: &["kind?"],
        cost: 20.0,
        description: "The resource nodes the Player sees now; with `kind` (\"forest\", \"stone\", \"ironOre\" or \"goldOre\"), only those of that kind.",
        returns: ScriptType::List(&ScriptType::View("node")),
    },
    ScriptBinding {
        name: "lastSeen",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The buildings, construction sites and cities the Player has seen and that are out of their sight now, as they last saw them: each with `is` (\"building\" or \"city\") and `seenAt`, the tick they were last seen.",
        returns: ScriptType::List(&ScriptType::View("lastSeen")),
    },
    ScriptBinding {
        name: "offers",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The offers standing at storages in sight, my realm’s own wherever they are, and direct offers sent to my realm wherever they are, oldest first.",
        returns: ScriptType::List(&ScriptType::View("offer")),
    },
    ScriptBinding {
        name: "directives",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The admin directives in force, which every Player sees: target, reason and the price to buy one off (null when it can’t be).",
        returns: ScriptType::List(&ScriptType::View("directive")),
    },
    ScriptBinding {
        name: "waypoints",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "My Player’s waypoints, oldest first: the named markers they put on the map, which only they see.",
        returns: ScriptType::List(&ScriptType::View("waypoint")),
    },
    ScriptBinding {
        name: "demands",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The demands my realm sent or was sent that wait for an answer, oldest first.",
        returns: ScriptType::List(&ScriptType::View("demand")),
    },
    ScriptBinding {
        name: "withMemory",
        is: Is::Query,
        params: &["key", "value"],
        cost: 20.0,
        description: "My realm’s residents running a script whose `memory[key]` is `value`, as `residents()` shows them, with their `script.memory`.",
        returns: ScriptType::List(&ScriptType::View("resident")),
    },
    ScriptBinding {
        name: "building",
        is: Is::Query,
        params: &["id"],
        cost: 1.0,
        description: "The building or construction site with that id, if the Player sees it or it is one of my realm’s cities’; else null.",
        returns: ScriptType::View("building"),
    },
    ScriptBinding {
        name: "buildingAt",
        is: Is::Query,
        params: &["x", "y"],
        cost: 1.0,
        description: "The building or construction site on a tile, roads and carriage sites left out, as `building(id)` gives it; null where there is none or the Player doesn’t see it.",
        returns: ScriptType::View("building"),
    },
    ScriptBinding {
        name: "inCityArea",
        is: Is::Query,
        params: &["cityId", "x", "y"],
        cost: 1.0,
        description: "Whether a tile lies in that city’s area, for a city of my realm’s or a tile the Player sees; false for any other.",
        returns: ScriptType::Boolean,
    },
    ScriptBinding {
        name: "cityAreaAt",
        is: Is::Query,
        params: &["x", "y"],
        cost: 1.0,
        description: "The id of the city whose area a tile lies in, one of my realm’s first where areas overlap; null where there is none, or the tile is the area of no city of my realm and the Player doesn’t see it.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "outsidersIn",
        is: Is::Query,
        params: &["cityId"],
        cost: 20.0,
        description: "The outsiders the Player sees in that city’s area: those of another realm, not allied, leaving out Trade Organization caravans and wandering traders with their crews.",
        returns: ScriptType::List(&ScriptType::View("resident")),
    },
    ScriptBinding {
        name: "pileAt",
        is: Is::Query,
        params: &["x", "y"],
        cost: 1.0,
        description: "The goods lying on a tile, like {food: 3}, if the Player sees it; null where none lie or it isn’t seen.",
        returns: ScriptType::View("goods"),
    },
    ScriptBinding {
        name: "outputOf",
        is: Is::Query,
        params: &["building"],
        cost: 1.0,
        description: "The goods a workplace makes, as a list (at a smithy everything it can make); empty for any other building.",
        returns: ScriptType::List(&ScriptType::String),
    },
    ScriptBinding {
        name: "materialsNeeded",
        is: Is::Query,
        params: &["site"],
        cost: 1.0,
        description: "The materials a construction site still lacks, as a list like [{good: \"wood\", units: 12}]; empty once it has them all, and for a finished building.",
        returns: ScriptType::List(&ScriptType::View("material")),
    },
    ScriptBinding {
        name: "lineTiles",
        is: Is::Query,
        params: &["line", "from?"],
        cost: 20.0,
        description: "The tiles of a Build line still to build, from its start to its end; with `from`, something with `x` and `y`, nearest first. `line` is like {building: \"wall\", from: {x: 3, y: 4}, to: {x: 8, y: 4}}, as the Build line task keeps it in `memory.line`, road or wall, straight or diagonal. Tiles the Player sees with one already, or that can’t take one, are left out.",
        returns: ScriptType::List(&ScriptType::View("lineTile")),
    },
    ScriptBinding {
        name: "terrainAt",
        is: Is::Query,
        params: &["x", "y"],
        cost: 1.0,
        description: "The terrain of a tile (\"plains\", \"forest\", \"hills\", \"mountain\", \"lake\" or \"sea\"), or null where the Player hasn’t explored.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "distance",
        is: Is::Query,
        params: &["a", "b"],
        cost: 1.0,
        description: "Tiles between two things with `x` and `y`, the short way round the map.",
        returns: ScriptType::Number,
    },
    ScriptBinding {
        name: "floor",
        is: Is::Query,
        params: &["n"],
        cost: 1.0,
        description: "The whole number at or below `n`: `floor(2.7)` is 2, `floor(-2.5)` is -3.",
        returns: ScriptType::Number,
    },
    ScriptBinding {
        name: "pickRandom",
        is: Is::Query,
        params: &["list"],
        cost: 1.0,
        description: "One item of a list, picked with `random`, so every script picking from the same list this tick picks the same; null for an empty list.",
        returns: ScriptType::Any,
    },
    ScriptBinding {
        name: "fits",
        is: Is::Query,
        params: &["good"],
        cost: 1.0,
        description: "How many units of a good still fit in my hands.",
        returns: ScriptType::Number,
    },
    ScriptBinding {
        name: "inputToFetch",
        is: Is::Query,
        params: &["workplace", "makes?"],
        cost: 1.0,
        description: "At a smelter, mint or smithy I see, the goods it lacks for a batch of its recipe (the one making `makes`, else its only one) in its pile and its workers’ hands: of each, as many batches’ worth as fit in my hands, as a list like [{good: \"ironOre\", units: 24}]; empty while it has a batch’s, when none fits, and for any other building.",
        returns: ScriptType::List(&ScriptType::View("material")),
    },
    ScriptBinding {
        name: "breedingPair",
        is: Is::Query,
        params: &["stable"],
        cost: 1.0,
        description: "The two horses of mine I would `breed` in a stable I see, as ids like [\"h1\", \"h2\"]: a pair whose breeding it keeps first, else two fed ones standing in it; null while there are none.",
        returns: ScriptType::List(&ScriptType::String),
    },
    ScriptBinding {
        name: "storages",
        is: Is::Query,
        params: &["from?", "goods?"],
        cost: 20.0,
        description: "The finished storages of my realm (of my city, for an NPC city’s resident); with `from`, something with `x` and `y`, nearest first by my `walkTime` from it; with `goods`, a list of goods, only those holding any of them.",
        returns: ScriptType::List(&ScriptType::View("building")),
    },
    ScriptBinding {
        name: "walkTime",
        is: Is::Query,
        params: &["a", "b"],
        cost: 20.0,
        description: "About how many ticks I take to walk from one thing with `x` and `y` to another: the straight way across the terrain, diagonally where it slants, roads and walls left out.",
        returns: ScriptType::Number,
    },
    ScriptBinding {
        name: "wayFood",
        is: Is::Query,
        params: &["a", "b"],
        cost: 20.0,
        description: "About how many units of Food I eat on the way from one thing with `x` and `y` to another, the way `walkTime` reckons it, at what each tile’s terrain costs me; riding, my horse’s too, which it eats from the Food I carry.",
        returns: ScriptType::Number,
    },
    ScriptBinding {
        name: "exploredEdge",
        is: Is::Query,
        params: &["from", "toward?", "skip?"],
        cost: 20.0,
        description: "The nearest tile to `from`, something with `x` and `y`, at the edge of my Player’s explored terrain: one they explored that I can go onto now (riding, one my horse can), beside one they haven’t. With `toward`, a compass direction (\"north\", \"northeast\", \"east\", \"southeast\", \"south\", \"southwest\", \"west\" or \"northwest\"), only tiles that way from `from`, at most 45° off it, the straightest first. With `skip`, a list of things with `x` and `y`, none within 8 tiles of them. Null with none within 192 tiles.",
        returns: ScriptType::View("tile"),
    },
    ScriptBinding {
        name: "crewTile",
        is: Is::Query,
        params: &["building"],
        cost: 1.0,
        description: "Where to stand at a building I see to work, build or breed there: the tile of its footprint with the fewest of my realm’s crew on it (those holding a work-at, build or breed order there, and those on their way with the tile in their `memory.at`), the nearest to me on ties, so my own tile while it is among the fewest; null for a building I don’t see.",
        returns: ScriptType::View("tile"),
    },
    ScriptBinding {
        name: "walkTo",
        is: Is::Action,
        params: &["x", "y"],
        cost: 10.0,
        description: "Walk to a tile.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "drive",
        is: Is::Action,
        params: &["carriageId", "x", "y", "horseId"],
        cost: 10.0,
        description: "Drive the carriage on my tile to a tile. Another realm’s carriage is stolen by that: it joins my realm at once, which is theft (see Standing). A carriage of mine with no horse of my realm there takes another realm’s only if I name it as `horseId`, which steals it too.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "mount",
        is: Is::Action,
        params: &["horseId"],
        cost: 10.0,
        description: "Get on a horse on my tile that pulls no carriage, and ride it. Another realm’s horse is stolen by that: it joins my realm at once, which is theft (see Standing).",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "dismount",
        is: Is::Action,
        params: &[],
        cost: 10.0,
        description: "Get off the horse I ride; it stays on my tile.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "unhitch",
        is: Is::Action,
        params: &["carriage"],
        cost: 10.0,
        description: "Unhitch the horse from a carriage of my realm on my tile, by it or its id; the horse stands free there, and a driver stops.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "hitch",
        is: Is::Action,
        params: &["carriage", "horse"],
        cost: 10.0,
        description: "Hitch a horse to a carriage of my realm on my tile, each by it or its id, at once: a horse of my realm on that tile that pulls no carriage, nobody rides and isn’t Down. A horse already hitched stands free there.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "board",
        is: Is::Action,
        params: &["carriageId"],
        cost: 10.0,
        description: "Get on a carriage of my realm on my tile as a passenger, and ride along with it.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "getOff",
        is: Is::Action,
        params: &["x?", "y?"],
        cost: 10.0,
        description: "Get off the carriage I am aboard, onto its tile or the tile x, y right next to it.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "haul",
        is: Is::Action,
        params: &["carriageId", "x", "y", "goods", "returnGoods?", "keepFood?"],
        cost: 10.0,
        description: "Drive a haul route between my tile and (x, y): `goods` there, `returnGoods` back.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "stop",
        is: Is::Action,
        params: &[],
        cost: 10.0,
        description: "Stop what I was ordered to do and stand idle.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "end",
        is: Is::Action,
        params: &["reason?"],
        cost: 10.0,
        description: "End this script: once this run is over I stand idle and run it no more, and in a queue its next step starts. With `reason`, short text (cut to 60 characters), my Player’s realm log says why, like “Ana stopped Work: no workplace on her tile”. It asks for no order.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "wait",
        is: Is::Action,
        params: &[],
        cost: 10.0,
        description: "Wait on my order: once this run is over I am not run again until it ends, is replaced or I am struck; then I run every tick again. With no order, it does nothing. It asks for no order.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "doing",
        is: Is::Action,
        params: &["text"],
        cost: 10.0,
        description: "Say what I’m doing, for my Player’s Doing line: the text (cut to 60 characters) shows instead of the one the game derives from my task and order, until I call it again; null gives the derived one back. Kept as `memory.doing`; it asks for no order.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "log",
        is: Is::Action,
        params: &["text"],
        cost: 10.0,
        description: "Add a line to my script log, with the game time: short text (cut to 60 characters) that my Player sees on my Script tab, and nobody else. I keep my last 20 lines across scripts; `end(reason)` adds its reason too. It asks for no order.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "pickUp",
        is: Is::Action,
        params: &["spot", "goods"],
        cost: 10.0,
        description: "Take goods from a spot on my tile: {kind: \"ground\"}, {kind: \"storage\", storageId}, {kind: \"site\", siteId}, {kind: \"carriage\", carriageId} or a Down resident lying there, {kind: \"resident\", residentId}; goods like {food: 3}.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "drop",
        is: Is::Action,
        params: &["spot", "goods"],
        cost: 10.0,
        description: "Put carried goods down at a spot on my tile.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "store",
        is: Is::Action,
        params: &["goods", "to?", "ownFood?"],
        cost: 10.0,
        description: "Walk to `to` (a storage, a stable or a carriage of mine; by default the nearest storage of my realm), put the goods down there and, at a storage with Food, top up my own food. Goods like {wood: 10}, or a list like [\"wood\"] for all I carry of them (Food beyond my own food). `ownFood`, units of Food, is the own food to keep and top up to instead of the usual. My order is \"store\" until done; then `me.orderEnded` says how it ended.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "fetch",
        is: Is::Action,
        params: &["goods", "from?"],
        cost: 10.0,
        description: "Walk to `from` (a storage, a stable or a carriage of mine; by default the nearest storage or carriage of my realm holding any of the goods) and take the goods there, as much as fits. Goods like {wood: 10}, or a list like [\"wood\"] for as much as there is. My order is \"fetch\" until done; then `me.orderEnded` says how it ended.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "build",
        is: Is::Action,
        params: &["building"],
        cost: 10.0,
        description: "Lay out or join a construction site of that kind on my tile.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "tearDown",
        is: Is::Action,
        params: &["buildingId"],
        cost: 10.0,
        description: "Tear down the building or site on my tile.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "workAt",
        is: Is::Action,
        params: &["makes?"],
        cost: 10.0,
        description: "Work the workplace on my tile; at a smithy, say what to make.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "teach",
        is: Is::Action,
        params: &["subject"],
        cost: 10.0,
        description: "Teach a stat (\"strength\", \"endurance\", \"agility\", \"intellect\") or a skill (\"combat\", …) at the training ground on my tile, while I stand there. One teacher per ground.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "train",
        is: Is::Action,
        params: &[],
        cost: 10.0,
        description: "Train at the training ground on my tile, while I stand there: I learn its subject while a teacher is there, never past the teacher. Room for 6 trainees per ground.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "breed",
        is: Is::Action,
        params: &["stableId", "horseIds"],
        cost: 10.0,
        description: "At the stable I stand at, tend two fed horses of mine in it, like [\"h1\", \"h2\"], until their foal is born.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "pair",
        is: Is::Action,
        params: &["partnerId"],
        cost: 10.0,
        description: "Pair with an adult of my city to have children.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "attack",
        is: Is::Action,
        params: &["targetId"],
        cost: 10.0,
        description: "Go after a resident I see and strike them, or strike a wall or gate of another realm until it falls.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "feed",
        is: Is::Action,
        params: &["targetId", "units"],
        cost: 10.0,
        description: "Feed a resident who is Down or a horse that isn’t full, of any realm, on or next to my tile, with up to that many units of the Food in my hands. A resident gets it in their hands, eats at once and wakes at low health. A horse eats until it is full, and wakes if it was Down; the rest stays with me.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "climb",
        is: Is::Action,
        params: &["wallId"],
        cost: 10.0,
        description: "Climb over the wall or gate of another realm next to me.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "pay",
        is: Is::Action,
        params: &["contractId", "weeks"],
        cost: 10.0,
        description: "On a mercenary contract’s storage, put in the coins for some weeks of it.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "buyCity",
        is: Is::Action,
        params: &["cityId"],
        cost: 10.0,
        description: "On an NPC city’s town hall, buy it with the coins my realm’s residents there carry.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "buy",
        is: Is::Action,
        params: &["good", "units", "carriageId?", "cityId?"],
        cost: 10.0,
        description: "On a Trade Org warehouse, an NPC city’s storage or the tile of a wandering trader standing at a stop, buy up to `units` of a good at its prices with the coins in my hands, or on my carriage there. At a warehouse, with `cityId`, one of my realm’s cities, a caravan delivers them to its storage for a fee.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "sell",
        is: Is::Action,
        params: &["good", "units", "carriageId?", "cityId?"],
        cost: 10.0,
        description: "On a Trade Org warehouse, an NPC city’s storage or the tile of a wandering trader standing at a stop, sell up to `units` of a good at its prices from my hands, or from my carriage there. At a warehouse, with `cityId` (and no carriage), a caravan picks them up from that city’s storage and pays there, less a fee.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "swap",
        is: Is::Action,
        params: &["give", "want", "units", "carriageId?"],
        cost: 10.0,
        description: "On a Trade Org warehouse or an NPC city’s storage, get up to `units` of the good `want` for as much of the good `give` as pays for them at its prices, rounded up, from my hands, or from my carriage there. What is over comes back in Coins as far as it holds them. An NPC city swaps only its surplus for what it is short of.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "buyHorse",
        is: Is::Action,
        params: &["horse"],
        cost: 10.0,
        description: "At an NPC city’s finished stable, buy a horse standing in it that it can spare, by it or its id, with the coins in my hands; they go into its storage, and the horse joins my realm where it stands. `city.horses` lists its horses with their prices and why it won’t sell one.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "sellHorse",
        is: Is::Action,
        params: &["horse"],
        cost: 10.0,
        description: "At an NPC city’s finished stable, sell it a horse of my realm standing in it, by it or its id; the coins go into my hands, and it doesn’t go if I can’t carry them. The horse joins the city where it stands. `city.horsesToSell` lists my horses there with what it pays and why it won’t buy one.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "handIn",
        is: Is::Action,
        params: &["good", "units", "toCityId", "carriageId?"],
        cost: 10.0,
        description: "On a Trade Org warehouse, hand in up to `units` of a good (coins too) from my hands, or from my carriage there, with the fee, for a caravan to bring to the storage of `toCityId`, a city of another realm.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "postOffer",
        is: Is::Action,
        params: &["storageId", "gives", "givesUnits", "wants", "wantsUnits", "times"],
        cost: 10.0,
        description: "At a finished storage of my realm, wherever I am, post an offer: gives `givesUnits` of a good, wants `wantsUnits` of another (either may be \"coins\"), `times` over or as many times as goods not set aside there allow. Those goods are set aside at once.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "takeDownOffer",
        is: Is::Action,
        params: &["offerId"],
        cost: 10.0,
        description: "Take down an offer of my realm; what it set aside is ordinary goods again.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "acceptOffer",
        is: Is::Action,
        params: &["offerId", "times", "carriageId?"],
        cost: 10.0,
        description: "On the storage of another’s offer, accept it up to `times` times over, paying from and taking into my hands, or my carriage there, as many times as I can pay and carry. A direct offer only the realm it was sent to can accept.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "sendDirectOffer",
        is: Is::Action,
        params: &["toId", "storageId", "gives", "givesUnits", "wants", "wantsUnits", "times"],
        cost: 10.0,
        description: "Send a realm my realm knows of an offer at a finished storage of my realm, wherever I am, on the terms of `postOffer`. They see it at once wherever they are, and only they can accept it, on its storage’s tile, until it lapses.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "sendCarriedOffer",
        is: Is::Action,
        params: &["toId", "fromCityId", "toCityId", "gives", "givesUnits", "wants", "wantsUnits", "times", "feeBy"],
        cost: 10.0,
        description: "Send a realm my realm knows of an offer the Trade Organization carries, between a city of my realm and one of theirs whose storage my realm sees, on the terms of `postOffer` and within one load each way. `feeBy` is \"sender\" or \"split\". Nothing is set aside; only they can accept it, from anywhere, until it lapses.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "acceptCarriedOffer",
        is: Is::Action,
        params: &["offerId"],
        cost: 10.0,
        description: "Accept a carried direct offer sent to my realm, whole, wherever I am: it becomes two Transfers.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "declineOffer",
        is: Is::Action,
        params: &["offerId"],
        cost: 10.0,
        description: "Decline a direct offer sent to my realm, wherever I am; its sender hears, and what it set aside is ordinary goods again.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "buyOff",
        is: Is::Action,
        params: &["directiveId", "carriageId?"],
        cost: 10.0,
        description: "On a Trade Org warehouse, pay the price of an admin directive against my realm with the coins in my hands, or on my carriage there, to end it.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "payDebt",
        is: Is::Action,
        params: &["coins", "carriageId?"],
        cost: 10.0,
        description: "On a Trade Org warehouse, pay up to `coins` of my realm’s debt to the Trade Organization with the coins in my hands, or on my carriage there: what I hold, up to what is owed.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "handOver",
        is: Is::Action,
        params: &["newLeaderId"],
        cost: 10.0,
        description: "As my realm’s Leader, make another resident its Leader: an adult of my realm serving no one else (no mercenary contract, not in the alliance army), standing in the same city of my realm as I do. Free and at once; I stay on as an ordinary resident.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "rename",
        is: Is::Action,
        params: &["residentId", "name", "realmName?"],
        cost: 10.0,
        description: "Give a resident of my realm, me or my Leader included, a new name: free and at once, from anywhere. Renaming the Leader of a realm with no realm name yet needs `realmName` too, which names the realm; a named realm keeps its name.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "renameCity",
        is: Is::Action,
        params: &["cityId", "name"],
        cost: 10.0,
        description: "Give a city of my realm a new name: free and at once, from anywhere. Others go on knowing it by its old name until they see it again.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "relocate",
        is: Is::Action,
        params: &["cityId"],
        cost: 10.0,
        description: "Walk to `cityId`, another city of my realm, and become its resident on stepping into its area, at once if I stand in it already: refused unless it has free housing for me, counting residents already relocating there, or while I carry a child. My order is \"relocate\" until done; then `me.orderEnded` says how it ended: reason null once I moved in, else why not (\"no free housing\", \"it is no longer your realm’s\" or \"the city is gone\"), and I keep my old city.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "renameHorse",
        is: Is::Action,
        params: &["horseId", "name"],
        cost: 10.0,
        description: "Give a horse of my realm a new name: free and at once, from anywhere, like renaming a resident. Names need not be unique.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "claimHorses",
        is: Is::Action,
        params: &[],
        cost: 10.0,
        description: "Claim my Player’s Horse offer: two new horses for my realm, in its stable nearest the Leader’s city, or else by a storage or the Leader with Food by them. Free and at once; refused once claimed, unless an admin has offered horses again, or while my realm has no living Leader.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "sendDemand",
        is: Is::Action,
        params: &["realmId", "terms", "note", "days"],
        cost: 10.0,
        description: "Send a realm my realm knows of a demand, wherever it is: `terms` is `{ kind: \"city\", cityId: id }` for a city of theirs I know of, or `{ kind: \"goods\", goods: { food: 5, coins: 20 } }`, with a note of at most 280 characters and a deadline 1 to 60 game days away. My realm sends at most 3 a game day. It is only words: nothing happens by itself when it is ignored. `realmId` can also be an NPC city I know of, or `\"trade-org\"`: the game answers within a game hour.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "acceptDemand",
        is: Is::Action,
        params: &["demandId", "handOver"],
        cost: 10.0,
        description: "Accept a demand sent to my realm. A demand for a city hands it over at once, also my last one; a city no longer mine is refused. A demand for goods or Coins names how they go in `handOver`: `{ way: \"setAside\", storageId: id }`, at a storage of mine for the sender alone to fetch, or `{ way: \"transfer\", fromCityId: id, toCityId: id }`, by Transfers from a city of mine to one of theirs whose storage I see, for a fee I pay. What the storage holds goes, up to what was demanded; with none of it there, it is refused. For the Trade Organization’s demand for my debt, its caravan fetches what is set aside at a storage in a city for no fee, and a Transfer goes to its nearest warehouse whatever `toCityId` says; what they bring in comes off the debt.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "declineDemand",
        is: Is::Action,
        params: &["demandId"],
        cost: 10.0,
        description: "Decline a demand sent to my realm.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "roadLine",
        is: Is::Action,
        params: &["x", "y"],
        cost: 10.0,
        description: "Build road on each tile of the line from my tile to (x, y), straight or diagonal, one after another, with the stone I carry.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "wallLine",
        is: Is::Action,
        params: &["x", "y"],
        cost: 10.0,
        description: "Build wall on each tile of the line from my tile to (x, y), straight or diagonal, one after another, with the materials I carry; tiles with a wall or gate already are skipped.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "addWaypoint",
        is: Is::Action,
        params: &["x", "y", "name"],
        cost: 10.0,
        description: "Put a waypoint named `name` on tile (x, y) for my Player, after those they hold: free and at once, from anywhere. Refused once they hold 50, counting those this run added (one removed makes room from the next run), or for a name longer than 30 characters.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "removeWaypoint",
        is: Is::Action,
        params: &["waypoint"],
        cost: 10.0,
        description: "Remove one of my Player’s waypoints, by it or its id: free and at once.",
        returns: ScriptType::String,
    },
];

/// The game API of an army's script (`ARMY_SCRIPT_API`).
pub static ARMY_SCRIPT_API: &[ScriptBinding] = &[
    ScriptBinding {
        name: "me",
        is: Is::Value,
        params: &[],
        cost: 0.0,
        description: "The army running the script: its `name`, `order`, `memberIds`, and its `members` as the Player sees them.",
        returns: ScriptType::View("army"),
    },
    ScriptBinding {
        name: "memory",
        is: Is::Value,
        params: &[],
        cost: 0.0,
        description: "An object kept between ticks for whoever runs it; whatever is set on it stays.",
        returns: ScriptType::Any,
    },
    ScriptBinding {
        name: "params",
        is: Is::Value,
        params: &[],
        cost: 0.0,
        description: "The values of the script’s `param` lines, picked on the resident card for whoever runs it: `params.name` for `param name: type`; a `number` param’s default (`param name: number = 3`) while none is set, else null.",
        returns: ScriptType::Any,
    },
    ScriptBinding {
        name: "debt",
        is: Is::Value,
        params: &[],
        cost: 0.0,
        description: "The Coins my realm owes the Trade Organization, 0 when it owes nothing: what its army came for and couldn’t take, and what crimes cost it since.",
        returns: ScriptType::Number,
    },
    ScriptBinding {
        name: "tick",
        is: Is::Value,
        params: &[],
        cost: 0.0,
        description: "The world tick this run is for.",
        returns: ScriptType::Number,
    },
    ScriptBinding {
        name: "mapSize",
        is: Is::Value,
        params: &[],
        cost: 0.0,
        description: "Tiles along each side of the map; its opposite sides join.",
        returns: ScriptType::Number,
    },
    ScriptBinding {
        name: "random",
        is: Is::Value,
        params: &[],
        cost: 0.0,
        description: "A number from 0 up to 1, drawn anew each tick and the same for every script that tick, so residents can agree on a random pick.",
        returns: ScriptType::Number,
    },
    ScriptBinding {
        name: "residents",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The residents the Player sees, their own included; those of their own running a script with its `script.memory`, to read but not change.",
        returns: ScriptType::List(&ScriptType::View("resident")),
    },
    ScriptBinding {
        name: "buildings",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The buildings and construction sites the Player sees, roads included.",
        returns: ScriptType::List(&ScriptType::View("building")),
    },
    ScriptBinding {
        name: "cities",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The cities the Player sees any of.",
        returns: ScriptType::List(&ScriptType::View("city")),
    },
    ScriptBinding {
        name: "horses",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The horses the Player sees.",
        returns: ScriptType::List(&ScriptType::View("horse")),
    },
    ScriptBinding {
        name: "carriages",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The carriages the Player sees.",
        returns: ScriptType::List(&ScriptType::View("carriage")),
    },
    ScriptBinding {
        name: "vessels",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The boats the Player sees on the water.",
        returns: ScriptType::List(&ScriptType::View("vessel")),
    },
    ScriptBinding {
        name: "traders",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The wandering traders the Player sees: those standing at a stop name where and their prices.",
        returns: ScriptType::List(&ScriptType::View("trader")),
    },
    ScriptBinding {
        name: "piles",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The piles of goods the Player sees.",
        returns: ScriptType::List(&ScriptType::View("pile")),
    },
    ScriptBinding {
        name: "nodes",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The resource nodes on terrain the Player has explored.",
        returns: ScriptType::List(&ScriptType::View("node")),
    },
    ScriptBinding {
        name: "nodesInSight",
        is: Is::Query,
        params: &["kind?"],
        cost: 20.0,
        description: "The resource nodes the Player sees now; with `kind` (\"forest\", \"stone\", \"ironOre\" or \"goldOre\"), only those of that kind.",
        returns: ScriptType::List(&ScriptType::View("node")),
    },
    ScriptBinding {
        name: "lastSeen",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The buildings, construction sites and cities the Player has seen and that are out of their sight now, as they last saw them: each with `is` (\"building\" or \"city\") and `seenAt`, the tick they were last seen.",
        returns: ScriptType::List(&ScriptType::View("lastSeen")),
    },
    ScriptBinding {
        name: "offers",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The offers standing at storages in sight, my realm’s own wherever they are, and direct offers sent to my realm wherever they are, oldest first.",
        returns: ScriptType::List(&ScriptType::View("offer")),
    },
    ScriptBinding {
        name: "directives",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The admin directives in force, which every Player sees: target, reason and the price to buy one off (null when it can’t be).",
        returns: ScriptType::List(&ScriptType::View("directive")),
    },
    ScriptBinding {
        name: "waypoints",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "My Player’s waypoints, oldest first: the named markers they put on the map, which only they see.",
        returns: ScriptType::List(&ScriptType::View("waypoint")),
    },
    ScriptBinding {
        name: "demands",
        is: Is::Query,
        params: &[],
        cost: 20.0,
        description: "The demands my realm sent or was sent that wait for an answer, oldest first.",
        returns: ScriptType::List(&ScriptType::View("demand")),
    },
    ScriptBinding {
        name: "withMemory",
        is: Is::Query,
        params: &["key", "value"],
        cost: 20.0,
        description: "My realm’s residents running a script whose `memory[key]` is `value`, as `residents()` shows them, with their `script.memory`.",
        returns: ScriptType::List(&ScriptType::View("resident")),
    },
    ScriptBinding {
        name: "building",
        is: Is::Query,
        params: &["id"],
        cost: 1.0,
        description: "The building or construction site with that id, if the Player sees it or it is one of my realm’s cities’; else null.",
        returns: ScriptType::View("building"),
    },
    ScriptBinding {
        name: "buildingAt",
        is: Is::Query,
        params: &["x", "y"],
        cost: 1.0,
        description: "The building or construction site on a tile, roads and carriage sites left out, as `building(id)` gives it; null where there is none or the Player doesn’t see it.",
        returns: ScriptType::View("building"),
    },
    ScriptBinding {
        name: "inCityArea",
        is: Is::Query,
        params: &["cityId", "x", "y"],
        cost: 1.0,
        description: "Whether a tile lies in that city’s area, for a city of my realm’s or a tile the Player sees; false for any other.",
        returns: ScriptType::Boolean,
    },
    ScriptBinding {
        name: "cityAreaAt",
        is: Is::Query,
        params: &["x", "y"],
        cost: 1.0,
        description: "The id of the city whose area a tile lies in, one of my realm’s first where areas overlap; null where there is none, or the tile is the area of no city of my realm and the Player doesn’t see it.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "outsidersIn",
        is: Is::Query,
        params: &["cityId"],
        cost: 20.0,
        description: "The outsiders the Player sees in that city’s area: those of another realm, not allied, leaving out Trade Organization caravans and wandering traders with their crews.",
        returns: ScriptType::List(&ScriptType::View("resident")),
    },
    ScriptBinding {
        name: "pileAt",
        is: Is::Query,
        params: &["x", "y"],
        cost: 1.0,
        description: "The goods lying on a tile, like {food: 3}, if the Player sees it; null where none lie or it isn’t seen.",
        returns: ScriptType::View("goods"),
    },
    ScriptBinding {
        name: "outputOf",
        is: Is::Query,
        params: &["building"],
        cost: 1.0,
        description: "The goods a workplace makes, as a list (at a smithy everything it can make); empty for any other building.",
        returns: ScriptType::List(&ScriptType::String),
    },
    ScriptBinding {
        name: "materialsNeeded",
        is: Is::Query,
        params: &["site"],
        cost: 1.0,
        description: "The materials a construction site still lacks, as a list like [{good: \"wood\", units: 12}]; empty once it has them all, and for a finished building.",
        returns: ScriptType::List(&ScriptType::View("material")),
    },
    ScriptBinding {
        name: "lineTiles",
        is: Is::Query,
        params: &["line", "from?"],
        cost: 20.0,
        description: "The tiles of a Build line still to build, from its start to its end; with `from`, something with `x` and `y`, nearest first. `line` is like {building: \"wall\", from: {x: 3, y: 4}, to: {x: 8, y: 4}}, as the Build line task keeps it in `memory.line`, road or wall, straight or diagonal. Tiles the Player sees with one already, or that can’t take one, are left out.",
        returns: ScriptType::List(&ScriptType::View("lineTile")),
    },
    ScriptBinding {
        name: "terrainAt",
        is: Is::Query,
        params: &["x", "y"],
        cost: 1.0,
        description: "The terrain of a tile (\"plains\", \"forest\", \"hills\", \"mountain\", \"lake\" or \"sea\"), or null where the Player hasn’t explored.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "distance",
        is: Is::Query,
        params: &["a", "b"],
        cost: 1.0,
        description: "Tiles between two things with `x` and `y`, the short way round the map.",
        returns: ScriptType::Number,
    },
    ScriptBinding {
        name: "floor",
        is: Is::Query,
        params: &["n"],
        cost: 1.0,
        description: "The whole number at or below `n`: `floor(2.7)` is 2, `floor(-2.5)` is -3.",
        returns: ScriptType::Number,
    },
    ScriptBinding {
        name: "pickRandom",
        is: Is::Query,
        params: &["list"],
        cost: 1.0,
        description: "One item of a list, picked with `random`, so every script picking from the same list this tick picks the same; null for an empty list.",
        returns: ScriptType::Any,
    },
    ScriptBinding {
        name: "walkTo",
        is: Is::Action,
        params: &["x", "y"],
        cost: 10.0,
        description: "The army walks to a tile together.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "guard",
        is: Is::Action,
        params: &["x", "y"],
        cost: 10.0,
        description: "The army walks to a tile together and stays there.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "attack",
        is: Is::Action,
        params: &["targetId"],
        cost: 10.0,
        description: "The army goes after a resident of another realm in sight.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "follow",
        is: Is::Action,
        params: &["targetId"],
        cost: 10.0,
        description: "The army keeps in contact with a resident in sight.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "stop",
        is: Is::Action,
        params: &[],
        cost: 10.0,
        description: "The army stops: its order ends.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "addWaypoint",
        is: Is::Action,
        params: &["x", "y", "name"],
        cost: 10.0,
        description: "Put a waypoint named `name` on tile (x, y) for my Player, after those they hold: free and at once, from anywhere. Refused once they hold 50, counting those this run added (one removed makes room from the next run), or for a name longer than 30 characters.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "removeWaypoint",
        is: Is::Action,
        params: &["waypoint"],
        cost: 10.0,
        description: "Remove one of my Player’s waypoints, by it or its id: free and at once.",
        returns: ScriptType::String,
    },
];

/// What each param type accepts, for the Wiki and the editor (`PARAM_DESCRIPTIONS`), in the
/// order of `SCRIPT_PARAM_TYPES`.
pub static PARAM_DESCRIPTIONS: &[(&str, &str)] = &[
    ("building", "One of my realm’s buildings, or a workplace or construction site of anyone’s I know: in sight, or as last seen."),
    ("storage", "One of my realm’s storages or stables, or one of its carriages."),
    ("number", "A whole number of zero or more, typed in; `= n` after the type gives it a default."),
    ("choice", "One of the words its line lists, `choice(north, east, south, west)`, picked from a list and read as that word; `= north` after the list gives it a default."),
    ("waypoint", "One of my waypoints, picked from a list or on the map, read as its `id`, `name`, `x` and `y`; unset once it is removed."),
];

/// Each task's default script: its name as the UI shows it, and its source
/// (`DEFAULT_SCRIPTS`), in the order of `TASKS`.
pub static DEFAULT_SCRIPTS: &[(Task, &str, &str)] = &[
    (
        Task::Work,
        "Work",
        r#"// Work (default): work params.workplace, or while none is picked the
// workplace on my tile when I start, kept in memory.workplaceId; with none I
// end. params.storage is my main storage: params.output, params.input and
// params.food each take its place for one use while picked. Once the pile
// holds a full load, one of us, picked at random, stores it in
// params.output, else params.storage, else the nearest storage of my realm,
// brings back the Food the pile lacks of params.crewFood for the crew's
// meals from params.food, else params.storage, else the nearest storage with
// Food (none to a farm, whose pile keeps its own; crewFood 0 brings none)
// and comes back. At a smelter, mint or smithy lacking the input for a
// batch, one of us, picked at random, fetches a load at params.input, else
// params.storage, while it holds some, else at the nearest storage of my
// realm holding it, and puts it on the pile; not while one of us carries the
// output, and with none anywhere we stand idle. At a smithy, memory.makes
// says what to make. Meals come from the workplace's pile on their own,
// without an order. Below
// params.foodAt units of Food on me, while the pile holds none, I get Food
// up to params.foodTake at params.food, else params.storage, else the
// nearest storage of my realm with Food, and come back; storing a load tops
// my food up to foodTake too. foodAt 0 turns getting food off. At the workplace we stand spread over
// its footprint. A workplace still being built I build first, as Build would,
// with materials from the nearest storage of my realm holding them, then work
// it once it is finished.
param workplace: building // the workplace to work; none: the one I stand on
param storage: storage // my main storage, for output, inputs and Food; none: the nearest storage of my realm
param output: storage // where the output goes; none: my storage, else the nearest storage of my realm
param input: storage // where inputs come from; none: my storage, else the nearest storage holding them
param food: storage // where Food comes from; a carriage too; none: my storage, else the nearest storage with Food
param foodAt: number = 1 // get Food below this many units on me; 0 never
param foodTake: number = 3 // units of Food to take along
param crewFood: number = 20 // Food the pile keeps for the crew's meals; 0 none
let keepFood = 2 // Food a farm's pile keeps for our refills

if (!pickWorkplace()) { return }
let workplace = building(memory.workplaceId)
if (memory.siteId != null && buildFirst(workplace)) { return }
// Where I stand at it: the footprint tile with the fewest of us (Spreading
// over the footprint), picked when I set out and again whenever I stand idle
// there; kept while I hold my order or am away, so I neither drift nor lose
// my spot. One picked out of sight is where I last saw it, until I see it.
// Already at work there, I keep the tile I stand on.
if (memory.at == null && me.order != null && me.order.kind == "workAt") {
  memory.at = {x: me.x, y: me.y}
} else if (me.order == null && workplace != null && memory.carry == null && memory.food == null && memory.input == null) {
  memory.at = crewTile(workplace)
}
if (memory.at == null && params.workplace != null) {
  memory.at = {x: params.workplace.x, y: params.workplace.y}
}
if (memory.at == null || memory.stuck) { return }
if (me.order != null && me.order.kind != "workAt") { // on my way
  wait()
  return
}

if (storeLoad()) { return }
if (walkBack()) { return }
if (workplace == null) { // here, and it isn't: torn down
  end("the workplace is gone")
  return
}
// With Food on the pile my meals come from there; with none anywhere, I work on.
let food = me.carried.food || 0
if (food < params.foodAt && !pileHoldsFood(workplace) && getFoodIfLow(params.food || params.storage, workplace)) {
  memory.food = {walked: false}
  return
}
if (me.order == null) {
  if (memory.input != null) { // back with inputs: onto the pile
    let load = carriedOf(me, memory.input.missing)
    memory.input = null
    if (load != null && drop({kind: "ground"}, load) == null) { return }
  }
  if (workAt(memory.makes) != null && heldBySomeoneElse(workplace)) {
    end("the " + workplace.kind + " is held by someone else")
  }
  return
}
carryLoadOffIfFull(workplace)

// Which workplace I work: the one picked, else the one I started on, kept in
// memory.workplaceId. False once I end: neither is a workplace.
fn pickWorkplace() {
  if (params.workplace != null) {
    if (!isWorkplace(params.workplace)) {
      end("the " + params.workplace.kind + " is no workplace")
      return false
    }
    memory.workplaceId = params.workplace.id
    if (params.workplace.site != null) { memory.siteId = params.workplace.id } // built first
  }
  if (memory.workplaceId == null) {
    let here = buildingAt(me.x, me.y)
    if (!isWorkplace(here)) {
      end("no workplace on their tile")
      return false
    }
    memory.workplaceId = here.id
    if (here.site != null) { memory.siteId = here.id } // built first
  }
  return true
}

// A building that makes goods, or the construction site of one.
fn isWorkplace(b) {
  return b != null && outputOf(b).length > 0
}

// A workplace still being built (Working a site), kept in memory.siteId: I
// build it first, as Build would, and go on working it once it is finished.
// True while I build it.
fn buildFirst(site) {
  if (memory.at == null) { // starting
    if (site == null) {
      end("the site is gone")
      return true
    }
    memory.at = crewTile(site)
    log("building " + placeName(site) + " first, to work it")
  }
  if (memory.stuck) { return true }
  if (me.order != null && me.order.kind != "build") { // on my way
    wait()
    return true
  }
  if (me.x == memory.at.x && me.y == memory.at.y) {
    if (site == null) { // here, and it isn't: torn down
      end("the site is gone")
      return true
    }
    if (site.site == null) {
      log("the " + site.kind + " is finished: working it")
      memory.siteId = null
      memory.fetch = null
      memory.food = null
      return false
    }
  }
  // Idle and not away, I stand where the fewest of us build (Spreading over
  // the footprint).
  if (me.order == null && site != null && memory.fetch == null && memory.food == null) {
    memory.at = crewTile(site)
  }
  if (walkBack()) { return true }
  if (memory.fetch != null) { memory.fetch = null } // back with it
  if (bringCarried(site)) { return true }
  // With no Food anywhere, I build on.
  if (getFoodIfLow(params.food || params.storage, site)) {
    memory.food = {walked: false}
    return true
  }
  if (me.order == null) {
    let problem = build(site.kind)
    if (problem != null) { end("can't build the " + site.kind + ": " + problem) }
    return true
  }
  fetchMissing(site, null)
  return true
}

// Whether residents of another realm work it, so it has no room for me.
fn heldBySomeoneElse(workplace) {
  for (r of residents()) {
    let o = r.order
    if (r.owner != me.owner && o != null && o.kind == "workAt" && o.buildingId == workplace.id) {
      return true
    }
  }
  return false
}

// With a load picked up: store it, keeping my own food, then bring the
// crew's Food. True once I set off. Logged now, not when picking it up: that
// tick is our dearest already.
fn storeLoad() {
  let carry = memory.carry
  if (carry == null) { return false }
  if (carry.stored) { return bringCrewFood(carry) }
  carry.stored = true
  if (store(carry.goods, carry.storageId, params.foodTake) != null) {
    carry.crewFood = 0 // not storing: no crew food either
    return false
  }
  wait() // until it is stored
  let to = building(carry.storageId)
  if (carry.load != null && to != null) {
    log("pile full: carrying " + goodsText(carry.load, carry.goods) + " to " + placeName(to))
  }
  return true
}

// Crew food: with the load stored, I fetch the Food the pile lacks
// (carry.crewFood) at params.food, else params.storage, while it holds Food,
// else at the nearest storage of my realm with Food, before I walk back,
// once, as much as fits. True once I set off, which I log.
fn bringCrewFood(carry) {
  if (carry.fetched) { return false }
  carry.fetched = true
  let units = carry.crewFood
  if (units == null || units < 1) { return false }
  let fit = fits("food")
  if (units > fit) { units = fit }
  if (units < 1) { return false }
  let from = params.food || params.storage
  if (from == null || !holdsFood(from)) {
    from = null
    let stores = storages(me, ["food"]) // nearest first, holding some
    if (stores.length > 0) { from = stores[0] }
  }
  if (from == null || fetch({food: units}, from.id) != null) { return false }
  log("fetching " + units + " Food for the crew at " + placeName(from))
  return true
}

// Back with the crew's Food: I put it on the pile, keeping my own food up to
// params.foodTake, once. True once I drop it, which I log.
fn dropCrewFood() {
  let carry = memory.carry
  if (carry == null || !carry.fetched || carry.dropped) { return false }
  carry.dropped = true
  let food = me.carried.food
  if (food == null) { return false }
  let units = floor(food - params.foodTake)
  if (units > carry.crewFood) { units = carry.crewFood }
  if (units < 1) { return false }
  if (drop({kind: "ground"}, {food: units}) != null) { return false }
  log("put " + units + " Food on the pile for the crew")
  return true
}

// Away carrying a load off, fetching inputs or materials or getting food:
// walk back to the workplace, once; with no way back I stay put. True until
// I am there.
fn walkBack() {
  if (me.x == memory.at.x && me.y == memory.at.y) {
    if (memory.carry != null) {
      if (dropCrewFood()) { return true }
      memory.carry = null
    }
    if (memory.food != null) { memory.food = null }
    return false
  }
  let away = memory.carry
  if (away == null) { away = memory.food }
  if (away == null) { away = memory.input }
  if (away == null) { away = memory.fetch }
  if (away != null && away.walked) {
    memory.stuck = true
    log("no way back to the workplace")
  } else {
    if (walkTo(memory.at.x, memory.at.y) == null) { wait() } // until I am there
    if (away != null) { away.walked = true }
  }
  return true
}

// Once the pile holds a full load, one of us carries it off to params.output,
// else params.storage, else the nearest storage of my realm. Until it does,
// we fetch inputs we lack.
fn carryLoadOffIfFull(workplace) {
  let found = fullLoad(workplace)
  if (found == null) {
    fetchInputIfShort(workplace)
    return
  }
  let to = params.output || params.storage
  if (to == null) {
    let stores = storages(workplace) // nearest first
    if (stores.length == 0) { return } // none in reach: the pile grows
    to = stores[0]
  }
  if (pickCarrier(workplace) != me.id) { return }
  pickUp({kind: "ground"}, found.load)
  memory.carry = {
    storageId: to.id, goods: found.goods, load: found.load,
    crewFood: crewFoodToBring(workplace, found.goods),
  }
}

// Fetching inputs: lacking the input for a batch of my recipe, one of us,
// picked at random, fetches a load at params.input, else params.storage,
// while it holds some, else at the nearest storage of my realm holding it,
// kept in memory.input until back, when I put it on the pile. With none
// anywhere we stand idle.
fn fetchInputIfShort(workplace) {
  let missing = inputToFetch(workplace, memory.makes)
  if (missing.length == 0) { return }
  let goods = goodsOf(missing)
  let from = null
  if (params.input != null) { from = materialsFrom(workplace, goods, params.input) }
  if (from == null && params.storage != null) {
    from = materialsFrom(workplace, goods, params.storage)
  }
  if (from == null) { from = materialsFrom(workplace, goods, null) }
  if (from == null || pickInputFetcher(workplace) != me.id) { return }
  let load = {}
  for (m of missing) { load[m.good] = m.units }
  if (fetch(load, from.id) != null) { return }
  wait() // until I have it
  memory.input = {missing: missing}
  log("fetching " + goodsText(load, goods) + " from " + placeName(from))
}

// Who fetches inputs: one of us at work here, picked at random, so we all
// pick the same one. Null while one of us fetches some or carries a load.
fn pickInputFetcher(workplace) {
  let workers = []
  for (r of withMemory("workplaceId", workplace.id)) {
    let m = r.script.memory
    if (m.input != null || m.carry != null) { return null }
    if (r.order != null && r.order.kind == "workAt") { workers[workers.length] = r }
  }
  let fetcher = pickRandom(workers)
  if (fetcher == null) { return null }
  return fetcher.id
}

// The Food the pile lacks of params.crewFood, which I bring back for the
// crew's meals; none with a load of Food (a farm's), whose pile keeps its own.
fn crewFoodToBring(workplace, goods) {
  if (params.crewFood < 1) { return 0 }
  for (good of goods) {
    if (good == "food") { return 0 }
  }
  let pile = pileAt(workplace.x, workplace.y)
  let held = 0
  if (pile != null && pile.food != null) { held = pile.food }
  let units = floor(params.crewFood - held)
  if (units < 1) { return 0 }
  return units
}

// Whether the workplace's pile holds Food, where my meals come from on their
// own (no need to go for Food).
fn pileHoldsFood(workplace) {
  let pile = pileAt(workplace.x, workplace.y)
  return pile != null && pile.food != null && pile.food > 0
}

// What the pile holds of the workplace's goods, as {goods, load}, once one of
// them makes a full load; else null. A farm's pile keeps keepFood for refills.
fn fullLoad(workplace) {
  let pile = pileAt(workplace.x, workplace.y)
  let load = {}
  let goods = []
  let full = false
  for (good of outputOf(workplace)) {
    let units = 0
    if (pile != null && pile[good] != null) { units = pile[good] }
    if (good == "food") { units = units - keepFood }
    if (units > 0) {
      load[good] = units
      goods[goods.length] = good
      let fit = fits(good)
      if (fit > 0 && units >= fit) { full = true }
    }
  }
  if (!full) { return null }
  return {goods: goods, load: load}
}

// Who carries the load: one of us at work here, picked at random, so we all
// pick the same one. Null while one of us carries a load already.
fn pickCarrier(workplace) {
  let workers = []
  for (r of withMemory("workplaceId", workplace.id)) {
    if (r.script.memory.carry != null) { return null }
    if (r.order != null && r.order.kind == "workAt") { workers[workers.length] = r }
  }
  let carrier = pickRandom(workers)
  if (carrier == null) { return null }
  return carrier.id
}

// What I carry of what the site lacks goes in first. True once I drop it.
fn bringCarried(site) {
  let needed = materialsNeeded(site)
  let mine = carriedOf(me, needed)
  if (mine == null) { return false }
  drop({kind: "site", siteId: site.id}, mine)
  log("bringing " + goodsText(mine, goodsOf(needed)) + " to the site")
  return true
}

// While the site lacks materials, one of us fetches them, picked at random,
// from source, or the nearest storage of my realm holding them while it is
// null: my own food first, topped up to params.foodTake; then what is missing.
fn fetchMissing(site, source) {
  let missing = materialsNeeded(site)
  if (missing.length == 0) { return }
  let goods = goodsOf(missing)
  let from = materialsFrom(site, goods, source)
  if (from == null) { return } // none in storage: we just build
  if (pickFetcher(site, missing) != me.id) { return }
  let load = {}
  let topUp = foodToTake()
  if (topUp > 0) { load.food = topUp }
  for (m of missing) { load[m.good] = m.units }
  if (fetch(load, from.id) == null) {
    wait() // until I have it
    memory.fetch = {storageId: from.id, goods: load}
    log("fetching " + goodsText(load, goods) + " at " + placeName(from))
  }
}

// Where materials come from: source while it holds some of goods, else,
// while it is null, the nearest storage of my realm holding some.
fn materialsFrom(site, goods, source) {
  let from = source
  if (from == null) {
    let stores = storages(site, goods) // nearest first, holding some
    if (stores.length == 0) { return null }
    return stores[0]
  }
  let held = from.stock
  if (held == null) { held = from.load } // a carriage
  if (held == null) { return null }
  for (g of goods) {
    if (held[g] != null && held[g] > 0) { return from }
  }
  return null
}

// Who fetches: one of us building the site, picked at random, so we all pick
// the same one. Null while one of us fetches, or brings some, already.
fn pickFetcher(site, missing) {
  let builders = []
  for (r of withMemory("siteId", site.id)) {
    if (r.script.memory.fetch != null) { return null }
    if (carriedOf(r, missing) != null) { return null }
    if (r.order != null && r.order.kind == "build") { builders[builders.length] = r }
  }
  let fetcher = pickRandom(builders)
  if (fetcher == null) { return null }
  return fetcher.id
}

// What someone carries of what the site lacks; null if nothing.
fn carriedOf(r, missing) {
  let load = null
  for (m of missing) {
    let n = r.carried[m.good]
    if (n != null && n > 0) {
      if (n > m.units) { n = m.units }
      if (load == null) { load = {} }
      load[m.good] = n
    }
  }
  return load
}

// The goods of what the site lacks.
fn goodsOf(missing) {
  let goods = []
  for (m of missing) { goods[goods.length] = m.good }
  return goods
}

// Getting food: below params.foodAt units of Food on me, fetch Food up to
// params.foodTake at from while it holds Food, else at the nearest storage of
// my realm with Food from near. True once I set off, which I log; I wait
// until I have it.
fn getFoodIfLow(from, near) {
  let food = me.carried.food
  if (food == null) { food = 0 }
  if (food >= params.foodAt) { return false }
  let units = floor(params.foodTake - food) // fetch takes whole units
  if (units < 1) { return false }
  let at = from
  if (at == null || !holdsFood(at)) {
    at = null
    let stores = storages(near, ["food"]) // nearest first, holding some
    if (stores.length > 0) { at = stores[0] }
  }
  if (at == null || fetch({food: units}, at.id) != null) { return false }
  wait() // until I have it
  log("low on Food (" + floor(food) + "): fetching " + units + " at " + placeName(at))
  return true
}

// Whether a storage, or a carriage, holds a whole unit of Food to fetch.
fn holdsFood(at) {
  let held = at.stock
  if (held == null) { held = at.load } // a carriage
  return held != null && held.food != null && held.food >= 1
}

// The Food that tops me up to params.foodTake, in whole units.
fn foodToTake() {
  let food = me.carried.food
  if (food == null) { food = 0 }
  let units = floor(params.foodTake - food)
  if (units < 1) { return 0 }
  return units
}


// A building or carriage for my log: "the storage at 12,6".
fn placeName(b) {
  let kind = b.kind
  if (kind == null) { kind = "carriage" }
  return "the " + kind + " at " + b.x + "," + b.y
}

// The units of goods in load for my log: "10 stone, 4 wood".
fn goodsText(load, goods) {
  let text = ""
  for (g of goods) {
    let n = load[g]
    if (n != null && n >= 1) {
      if (text != "") { text = text + ", " }
      text = text + floor(n) + " " + g
    }
  }
  return text
}
"#,
    ),
    (
        Task::Build,
        "Build",
        r#"// Build (default): build a memory.building with the north-west tile of its
// footprint at memory.at, laying out the site or joining the one there, as
// the Build order gives it. Without one I join params.site, or while none is
// picked the construction site on my tile when I start; with none I end.
// While the site lacks materials, one of us building it, picked at random,
// fetches a load of what is missing from params.source, or the nearest
// storage of my realm that holds it while none is picked, and brings it
// back. With none there we just build. Below params.foodAt units of Food on
// me I get Food up to params.foodTake at params.food, else params.source,
// else the nearest storage of my realm with Food, and come back; fetching
// materials tops my food up to foodTake too. foodAt 0 turns getting food
// off. At the site we stand spread over its footprint.
param site: building // the construction site to join; none: the one I stand on
param source: storage // where materials come from; a carriage too; none: the nearest storage holding some
param food: storage // where Food comes from; a carriage too; none: my source, else the nearest storage with Food
param foodAt: number = 1 // get Food below this many units on me; 0 never
param foodTake: number = 3 // units of Food to take along

if (!pickSite()) { return }
if (memory.stuck) { return }
if (me.order != null && me.order.kind != "build") { // on my way
  wait()
  return
}

let site = null
if (memory.siteId != null) { site = building(memory.siteId) }
if (endIfDone(site)) { return }
spreadOut(site)
if (walkBack()) { return }
if (site != null && bringCarried(site)) { return }
// With no Food anywhere, I build on.
if (getFoodIfLow(params.food || params.source, me)) {
  memory.food = {walked: false}
  return
}
if (me.order == null) {
  startBuilding()
  return
}
if (me.order.siteId == null) { return } // laid out at the end of the tick
memory.siteId = me.order.siteId
if (site != null) { fetchMissing(site, params.source) }

// Which site I build: the Build order's, else the one picked, else the one I
// started on. False once I end: neither is a construction site.
fn pickSite() {
  if (memory.building != null) { return true }
  let join = params.site
  if (join == null) { join = buildingAt(me.x, me.y) }
  if (join == null || join.site == null) {
    if (params.site != null) { end("the " + params.site.kind + " is no construction site") }
    else { end("no construction site on their tile") }
    return false
  }
  memory.building = join.kind
  memory.at = crewTile(join)
  memory.siteId = join.id
  log("joining the site of " + placeName(join))
  return true
}

// At the site once it is laid out: finished or gone, building is done. True
// once I end.
fn endIfDone(site) {
  if (memory.siteId == null) { return false }
  if (me.x != memory.at.x || me.y != memory.at.y) { return false }
  if (site != null && site.site != null) { return false }
  if (site == null) { log("the site is gone") }
  else { log("the " + site.kind + " is finished") }
  end()
  return true
}

// Where I stand at the site: the footprint tile with the fewest of us
// (Spreading over the footprint), picked whenever I stand idle and not away;
// a site another of us laid out at memory.at counts too. Laying out a new
// site keeps the picked tile.
fn spreadOut(site) {
  if (me.order != null || memory.fetch != null || memory.food != null) { return }
  if (site == null) { site = buildingAt(memory.at.x, memory.at.y) }
  if (site != null && site.site != null && site.kind == memory.building) {
    memory.at = crewTile(site)
  }
}

// Not there yet, or away fetching or getting food: walk to the site, once;
// with no way back I stay put. True until I am there.
fn walkBack() {
  if (me.x == memory.at.x && me.y == memory.at.y) {
    if (memory.fetch != null) { memory.fetch = null }
    if (memory.food != null) { memory.food = null }
    return false
  }
  let away = memory.fetch
  if (away == null) { away = memory.food }
  if (away != null && away.walked) {
    memory.stuck = true
    log("no way back to the site")
  } else {
    if (walkTo(memory.at.x, memory.at.y) == null) { wait() } // until I am there
    if (away != null) { away.walked = true }
  }
  return true
}

// Laying out the site, or joining it. Turned down, such as with the tile
// taken, build says why: done.
fn startBuilding() {
  let problem = build(memory.building)
  if (problem != null) {
    log("can't build: " + problem)
    end()
  } else if (memory.siteId == null) {
    log("laying out a " + memory.building + " at " + memory.at.x + "," + memory.at.y)
  }
}

// What I carry of what the site lacks goes in first. True once I drop it.
fn bringCarried(site) {
  let needed = materialsNeeded(site)
  let mine = carriedOf(me, needed)
  if (mine == null) { return false }
  drop({kind: "site", siteId: site.id}, mine)
  log("bringing " + goodsText(mine, goodsOf(needed)) + " to the site")
  return true
}

// While the site lacks materials, one of us fetches them, picked at random,
// from source, or the nearest storage of my realm holding them while it is
// null: my own food first, topped up to params.foodTake; then what is missing.
fn fetchMissing(site, source) {
  let missing = materialsNeeded(site)
  if (missing.length == 0) { return }
  let goods = goodsOf(missing)
  let from = materialsFrom(site, goods, source)
  if (from == null) { return } // none in storage: we just build
  if (pickFetcher(site, missing) != me.id) { return }
  let load = {}
  let topUp = foodToTake()
  if (topUp > 0) { load.food = topUp }
  for (m of missing) { load[m.good] = m.units }
  if (fetch(load, from.id) == null) {
    wait() // until I have it
    memory.fetch = {storageId: from.id, goods: load}
    log("fetching " + goodsText(load, goods) + " at " + placeName(from))
  }
}

// Where materials come from: source while it holds some of goods, else,
// while it is null, the nearest storage of my realm holding some.
fn materialsFrom(site, goods, source) {
  let from = source
  if (from == null) {
    let stores = storages(site, goods) // nearest first, holding some
    if (stores.length == 0) { return null }
    return stores[0]
  }
  let held = from.stock
  if (held == null) { held = from.load } // a carriage
  if (held == null) { return null }
  for (g of goods) {
    if (held[g] != null && held[g] > 0) { return from }
  }
  return null
}

// Who fetches: one of us building the site, picked at random, so we all pick
// the same one. Null while one of us fetches, or brings some, already.
fn pickFetcher(site, missing) {
  let builders = []
  for (r of withMemory("siteId", site.id)) {
    if (r.script.memory.fetch != null) { return null }
    if (carriedOf(r, missing) != null) { return null }
    if (r.order != null && r.order.kind == "build") { builders[builders.length] = r }
  }
  let fetcher = pickRandom(builders)
  if (fetcher == null) { return null }
  return fetcher.id
}

// What someone carries of what the site lacks; null if nothing.
fn carriedOf(r, missing) {
  let load = null
  for (m of missing) {
    let n = r.carried[m.good]
    if (n != null && n > 0) {
      if (n > m.units) { n = m.units }
      if (load == null) { load = {} }
      load[m.good] = n
    }
  }
  return load
}

// The goods of what the site lacks.
fn goodsOf(missing) {
  let goods = []
  for (m of missing) { goods[goods.length] = m.good }
  return goods
}

// Getting food: below params.foodAt units of Food on me, fetch Food up to
// params.foodTake at from while it holds Food, else at the nearest storage of
// my realm with Food from near. True once I set off, which I log; I wait
// until I have it.
fn getFoodIfLow(from, near) {
  let food = me.carried.food
  if (food == null) { food = 0 }
  if (food >= params.foodAt) { return false }
  let units = floor(params.foodTake - food) // fetch takes whole units
  if (units < 1) { return false }
  let at = from
  if (at == null || !holdsFood(at)) {
    at = null
    let stores = storages(near, ["food"]) // nearest first, holding some
    if (stores.length > 0) { at = stores[0] }
  }
  if (at == null || fetch({food: units}, at.id) != null) { return false }
  wait() // until I have it
  log("low on Food (" + floor(food) + "): fetching " + units + " at " + placeName(at))
  return true
}

// Whether a storage, or a carriage, holds a whole unit of Food to fetch.
fn holdsFood(at) {
  let held = at.stock
  if (held == null) { held = at.load } // a carriage
  return held != null && held.food != null && held.food >= 1
}

// The Food that tops me up to params.foodTake, in whole units.
fn foodToTake() {
  let food = me.carried.food
  if (food == null) { food = 0 }
  let units = floor(params.foodTake - food)
  if (units < 1) { return 0 }
  return units
}


// A building or carriage for my log: "the storage at 12,6".
fn placeName(b) {
  let kind = b.kind
  if (kind == null) { kind = "carriage" }
  return "the " + kind + " at " + b.x + "," + b.y
}

// The units of goods in load for my log: "10 stone, 4 wood".
fn goodsText(load, goods) {
  let text = ""
  for (g of goods) {
    let n = load[g]
    if (n != null && n >= 1) {
      if (text != "") { text = text + ", " }
      text = text + floor(n) + " " + g
    }
  }
  return text
}
"#,
    ),
    (
        Task::Haul,
        "Haul",
        r#"// Haul (default): drive params.carriage, or while none is picked the carriage
// on my tile when I start, on a haul route between memory.from and memory.to:
// memory.goods there, memory.returnGoods back, memory.keepFood Food kept on
// board for the horse and me. The route comes only from the Haul order; started
// without one I end. The built-in haul order loads, drives and unloads, again
// and again; this starts it at memory.from.
param carriage: storage // the carriage to drive; none: the one I stand on

if (memory.to == null) {
  end("no route given")
  return
}
if (!pickCarriage()) { return }
if (me.order == null || me.order.kind != "haul") {
  startRoute()
  return
}
logLeg()

// Which carriage I drive: the one picked, else the one I started on. False
// once I end: neither is a carriage.
fn pickCarriage() {
  if (params.carriage != null) {
    if (params.carriage.kind != null) {
      end("the " + params.carriage.kind + " is no carriage")
      return false
    }
    memory.carriageId = params.carriage.id
  }
  if (memory.carriageId == null) {
    for (c of carriages()) {
      if (c.x == me.x && c.y == me.y) { memory.carriageId = c.id }
    }
    if (memory.carriageId == null) {
      end("no carriage on their tile")
      return false
    }
  }
  return true
}

// The haul order, once I stand at memory.from.
fn startRoute() {
  if (me.x != memory.from.x || me.y != memory.from.y) { return }
  haul(memory.carriageId, memory.to.x, memory.to.y, memory.goods, memory.returnGoods, memory.keepFood)
}

// Each leg of the route as it starts, for my log: loading at a stop, or
// driving to one.
fn logLeg() {
  let leg = me.order.phase + " " + me.order.stop
  if (memory.leg == leg) { return }
  memory.leg = leg
  let stop = memory.to
  if (me.order.stop == "from") { stop = memory.from }
  if (me.order.phase == "loading") { log("loading at " + stop.x + "," + stop.y) }
  else { log("driving to " + stop.x + "," + stop.y) }
}
"#,
    ),
    (
        Task::TearDown,
        "Tear down",
        r#"// Tear down (default): tear down params.building, or while none is picked
// the building or site on my tile when I start, kept in memory.buildingId,
// until it is gone; then end. With none I end. Away from it, I walk there
// first. Below params.foodAt units of Food on me I get Food up to
// params.foodTake at params.food, else params.source, else the nearest
// storage of my realm with Food, and come back. foodAt 0 turns it off.
param building: building // the building or site to tear down; none: the one I stand on
param source: storage // my main storage, for Food; a carriage too; none: the nearest storage with Food
param food: storage // where Food comes from; a carriage too; none: my source, else the nearest storage with Food
param foodAt: number = 1 // get Food below this many units on me; 0 never
param foodTake: number = 3 // units of Food to take along

if (memory.stuck) { return }
if (!pickBuilding()) { return }
if (memory.walked && me.order != null && me.order.kind == "walkTo") { // on my way
  wait()
  return
}
if (walkBack()) { return }
// With no Food anywhere, I tear down on.
let x = me.x
let y = me.y
if (getFoodIfLow(params.food || params.source, me)) {
  memory.food = {walked: false, x: x, y: y}
  return
}
if (me.order == null || me.order.kind != "tearDown") { startTearingDown() }

// What I tear down: the one picked, else the one I started on, kept in
// memory.buildingId. False once I end: there is none.
fn pickBuilding() {
  if (params.building != null) { memory.buildingId = params.building.id }
  if (memory.buildingId == null) {
    let here = buildingAt(me.x, me.y)
    if (here == null) {
      end("no building on their tile")
      return false
    }
    memory.buildingId = here.id
  }
  return true
}

// Away getting food: walk back to the tile I tear down from, once; with no
// way back I stay put. True until I am there.
fn walkBack() {
  let away = memory.food
  if (away == null) { return false }
  if (me.order != null && me.order.kind != "tearDown") { // on my way
    wait()
    return true
  }
  if (me.x == away.x && me.y == away.y) {
    memory.food = null
    return false
  }
  if (away.walked) {
    memory.stuck = true
    log("no way back to where I tear down")
  } else {
    if (walkTo(away.x, away.y) == null) { wait() } // until I am there
    away.walked = true
  }
  return true
}

// Tearing it down; picked somewhere else, I walk there once first. Turned
// down, such as with the building gone, tearDown says why: done.
fn startTearingDown() {
  let problem = tearDown(memory.buildingId)
  let target = building(memory.buildingId)
  if (target == null) { target = params.building } // picked out of sight: as last seen
  if (problem == "the resident is not at that building" && target != null && !memory.walked) {
    memory.walked = true
    if (walkTo(target.x, target.y) == null) { wait() } // until I am there
    log("walking to " + placeName(target) + " to tear it down")
    return
  }
  if (problem != null) {
    log(problem)
    end()
  } else if (target != null) { log("tearing down " + placeName(target)) }
}

// Getting food: below params.foodAt units of Food on me, fetch Food up to
// params.foodTake at from while it holds Food, else at the nearest storage of
// my realm with Food from near. True once I set off, which I log; I wait
// until I have it.
fn getFoodIfLow(from, near) {
  let food = me.carried.food
  if (food == null) { food = 0 }
  if (food >= params.foodAt) { return false }
  let units = floor(params.foodTake - food) // fetch takes whole units
  if (units < 1) { return false }
  let at = from
  if (at == null || !holdsFood(at)) {
    at = null
    let stores = storages(near, ["food"]) // nearest first, holding some
    if (stores.length > 0) { at = stores[0] }
  }
  if (at == null || fetch({food: units}, at.id) != null) { return false }
  wait() // until I have it
  log("low on Food (" + floor(food) + "): fetching " + units + " at " + placeName(at))
  return true
}

// Whether a storage, or a carriage, holds a whole unit of Food to fetch.
fn holdsFood(at) {
  let held = at.stock
  if (held == null) { held = at.load } // a carriage
  return held != null && held.food != null && held.food >= 1
}

// The Food that tops me up to params.foodTake, in whole units.
fn foodToTake() {
  let food = me.carried.food
  if (food == null) { food = 0 }
  let units = floor(params.foodTake - food)
  if (units < 1) { return 0 }
  return units
}


// A building or carriage for my log: "the storage at 12,6".
fn placeName(b) {
  let kind = b.kind
  if (kind == null) { kind = "carriage" }
  return "the " + kind + " at " + b.x + "," + b.y
}

// The units of goods in load for my log: "10 stone, 4 wood".
fn goodsText(load, goods) {
  let text = ""
  for (g of goods) {
    let n = load[g]
    if (n != null && n >= 1) {
      if (text != "") { text = text + ", " }
      text = text + floor(n) + " " + g
    }
  }
  return text
}
"#,
    ),
    (
        Task::Breed,
        "Breed horses",
        r#"// Breed horses (default): in params.stable, or while none is picked the
// stable I stand in when I start, kept in memory.stableId, tend the two
// horses memory.horseIds until their foal is born; then end. Without a pair
// given, I pick one in the stable: a pair whose breeding it keeps first,
// else two fed horses of my realm in it; with none, or no stable, I end.
// Away from the stable, walk there first; at it we stand spread over its
// footprint. Before starting, take Food for the days of tending from the
// stable, if it has some.
param stable: storage // the stable to breed in; none: the one I stand in
let needFood = 5 // Food I take along for my meals while tending

if (memory.done == true) { end() }
if (me.order != null && me.order.kind == "breed") {
  memory.started = true
  wait() // until the foal is born or the breeding stops
  return
}
if (memory.started == true) {
  // The foal was born, or the breeding stopped: done.
  log("the breeding is over")
  end()
  return
}
if (me.order != null && (me.order.kind == "walkTo" || me.order.kind == "pickUp")) {
  wait()
  return
}
if (!pickStable()) { return }
let stable = building(memory.stableId)
if (stable == null) {
  end("the stable is gone")
  return
}
if (!pickPair(stable)) { return }
if (takeFood()) { return }
if (walkToStable(stable)) { return }
startBreeding(stable)

// Which two: those given, else picked once I stand in the stable. False while
// I walk there, or once I end: there are no two to pick.
fn pickPair(stable) {
  if (memory.horseIds != null) { return true }
  let here = buildingAt(me.x, me.y)
  if ((here == null || here.id != stable.id) && walkToStable(stable)) { return false }
  let pair = breedingPair(stable)
  if (pair == null) {
    end("no two fed horses here")
    return false
  }
  memory.horseIds = pair
  return true
}

// Food for the days of tending, taken from the stable once, if it has some.
// True once I take it.
fn takeFood() {
  if (memory.fed == true) { return false }
  let food = me.carried.food
  if (food == null) { food = 0 }
  if (food >= needFood) { return false }
  let units = needFood - food
  let spot = {kind: "storage", storageId: memory.stableId}
  if (pickUp(spot, {food: units}) != null) { return false }
  memory.fed = true
  log("taking " + goodsText({food: units}, ["food"]) + " from the stable")
  return true
}

// Breeding the two; away from the stable, I walk there once first. Turned
// down, breed says why: done.
fn startBreeding(stable) {
  let problem = breed(memory.stableId, memory.horseIds)
  if (problem == null) {
    log("breeding two horses in " + placeName(stable))
    return
  }
  if (problem == "not standing at that stable" && walkToStable(stable)) { return }
  log(problem)
  end()
}

// Where I stand at it: the footprint tile with the fewest of us (Spreading
// over the footprint), the nearest on ties. I walk there once, kept as
// memory.at; still away from it after that, breed says why. True while I
// set out.
fn walkToStable(stable) {
  if (memory.walked == true) { return false }
  let at = crewTile(stable)
  if (me.x == at.x && me.y == at.y) { return false }
  memory.walked = true
  memory.at = at
  if (walkTo(at.x, at.y) == null) { wait() } // until I am there
  log("walking to " + placeName(stable))
  return true
}

// Which stable: the one picked, else the one I started in, kept in
// memory.stableId. False once I end: neither is a stable.
fn pickStable() {
  if (params.stable != null) {
    if (params.stable.kind != "stable") {
      end("the one picked is no stable")
      return false
    }
    memory.stableId = params.stable.id
  }
  if (memory.stableId == null) {
    let here = buildingAt(me.x, me.y)
    if (here == null || here.kind != "stable" || here.site != null) {
      end("no stable here")
      return false
    }
    memory.stableId = here.id
  }
  return true
}

// A building or carriage for my log: "the storage at 12,6".
fn placeName(b) {
  let kind = b.kind
  if (kind == null) { kind = "carriage" }
  return "the " + kind + " at " + b.x + "," + b.y
}

// The units of goods in load for my log: "10 stone, 4 wood".
fn goodsText(load, goods) {
  let text = ""
  for (g of goods) {
    let n = load[g]
    if (n != null && n >= 1) {
      if (text != "") { text = text + ", " }
      text = text + floor(n) + " " + g
    }
  }
  return text
}
"#,
    ),
    (
        Task::FeedStable,
        "Feed the stable",
        r#"// Feed the stable (default): keep Food for 10 game days for the
// horses standing in params.stable, or while none is picked in the stable I
// stand in when I start, kept in memory.stableId; with none, or once it is
// gone, I end. Below that I fetch what is missing from params.source, or
// the nearest storage of my realm with Food while none is picked, and store
// it in the stable; otherwise I wait there. memory.spareFood, kept only by an
// NPC city's feeder, is the most Food I may take now.
param stable: storage // the stable to feed; none: the one I stand in
param source: storage // where the Food comes from; a carriage too; none: the nearest storage with Food
let days = 10 // game days of Food to keep
let perHorse = 0.75 // Food a horse eats a game day
let side = 3 // tiles along each side of a stable

if (!pickStable()) { return }
let stable = building(memory.stableId)
// Kept for when it is out of sight.
if (stable != null) { memory.at = {x: stable.x, y: stable.y} }
if (me.order != null) { // on my way
  wait()
  return
}
if (stable == null) {
  walkBackOrEnd()
  return
}
if (storeFetched(stable)) { return }
if (fetchIfLow(stable)) { return }
// Enough, or none to fetch: wait at the stable.
if (!inStable(stable, me) && walkTo(stable.x, stable.y) == null) { wait() }

// Out of sight: back to it. There, and it isn't, it is torn down: I end.
fn walkBackOrEnd() {
  let at = memory.at
  if (at != null && (me.x != at.x || me.y != at.y) && walkTo(at.x, at.y) == null) {
    wait() // until I am there
    return
  }
  end("the stable is gone")
}

// Back with Food: what I fetched goes into the stable; my own food stays.
// True once I store it.
fn storeFetched(stable) {
  let fetched = memory.fetched
  if (fetched == null) { return false }
  memory.fetched = null
  let food = me.carried.food
  if (food == null) { return false }
  let got = floor(food - fetched.before)
  if (got < 1 || store({food: got}, stable.id) != null) { return false }
  wait() // until it is stored
  say("storing " + goodsText({food: got}, ["food"]) + " in the stable")
  return true
}

// Below the Food to keep for the horses in it now: fetch what is missing.
// True once I set off.
fn fetchIfLow(stable) {
  let held = 0
  if (stable.stock != null && stable.stock.food != null) { held = stable.stock.food }
  let need = horsesIn(stable) * days * perHorse - held
  if (need <= 0) {
    say("enough Food in the stable: waiting")
    return false
  }
  let from = foodFrom(stable)
  if (from != null) {
    let units = floor(need)
    if (units < need) { units = units + 1 } // whole units, rounded up
    if (memory.spareFood != null && units > memory.spareFood) { units = memory.spareFood }
    let before = me.carried.food
    if (before == null) { before = 0 }
    if (units >= 1 && fetch({food: units}, from.id) == null) {
      wait() // until I have it
      memory.fetched = {before: before}
      say("stable low (" + floor(held) + "): fetching " + units + " Food at " + placeName(from))
      return true
    }
  }
  say("stable low (" + floor(held) + "): no Food to fetch, waiting")
  return false
}

// Where the Food comes from: params.source, else the nearest storage of my
// realm with Food; null unless it holds a whole unit, or if it is the stable.
fn foodFrom(stable) {
  let from = params.source
  if (from == null) {
    let stores = storages(stable, ["food"]) // nearest first, holding some
    if (stores.length == 0) { return null }
    from = stores[0]
  }
  let held = from.stock
  if (held == null) { held = from.load } // a carriage
  if (from.id == stable.id || held == null || held.food == null || held.food < 1) { return null }
  return from
}

// The horses standing in the stable.
fn horsesIn(stable) {
  let n = 0
  for (h of horses()) {
    if (inStable(stable, h)) { n = n + 1 }
  }
  return n
}

// Whether something with x and y stands on the stable's footprint.
fn inStable(stable, t) {
  let dx = (t.x - stable.x + mapSize) % mapSize
  let dy = (t.y - stable.y + mapSize) % mapSize
  return dx < side && dy < side
}

// A line for my log, once until I say something else: waiting stays one line.
fn say(text) {
  if (memory.said != text) { log(text) }
  memory.said = text
}

// Which stable: the one picked, else the one I started in, kept in
// memory.stableId. False once I end: neither is a stable.
fn pickStable() {
  if (params.stable != null) {
    if (params.stable.kind != "stable") {
      end("the one picked is no stable")
      return false
    }
    memory.stableId = params.stable.id
  }
  if (memory.stableId == null) {
    let here = buildingAt(me.x, me.y)
    if (here == null || here.kind != "stable" || here.site != null) {
      end("no stable here")
      return false
    }
    memory.stableId = here.id
  }
  return true
}

// A building or carriage for my log: "the storage at 12,6".
fn placeName(b) {
  let kind = b.kind
  if (kind == null) { kind = "carriage" }
  return "the " + kind + " at " + b.x + "," + b.y
}

// The units of goods in load for my log: "10 stone, 4 wood".
fn goodsText(load, goods) {
  let text = ""
  for (g of goods) {
    let n = load[g]
    if (n != null && n >= 1) {
      if (text != "") { text = text + ", " }
      text = text + floor(n) + " " + g
    }
  }
  return text
}
"#,
    ),
    (
        Task::Defend,
        "Defend",
        r#"// Defend (default): what I do when struck, in place of what I was doing,
// which goes on once I end. Armed, I fight back at whoever struck me while
// they are in sight, and end once they are dead, gone or out of sight; a
// driver walks back to the carriage first, should the fight have led away.
// Unarmed, I walk home to my city's town hall, and end there, or once no
// blow has landed for calm ticks; but driving I end at once and drive on, and
// aboard a carriage being driven I end at once and stay aboard.
let calm = 30 // ticks without a blow before I go back, fleeing

if (armed()) {
  // My drive waits while I fight: kept for the way back to my carriage.
  if (holdsCarriage()) { memory.carriageId = me.order.carriageId }
  fightBack()
} else if (holdsCarriage() || betweenDrives() || aboardDriven()) {
  end()
} else {
  fleeHome()
}

// Whether I drive a carriage, or haul with one.
fn holdsCarriage() {
  let o = me.order
  return o != null && (o.kind == "drive" || o.kind == "haul")
}

// Between the drives of my queue: the next step comes once I end.
fn betweenDrives() {
  let q = me.queue
  return me.order == null && q != null && (q.kind == "drive" || q.kind == "haul")
}

// Whether the carriage I am aboard is being driven.
fn aboardDriven() {
  if (me.aboard == null) { return false }
  for (c of carriages()) {
    if (c.id == me.aboard) { return !c.standsStill }
  }
  return false
}

// Whether I carry a weapon.
fn armed() {
  for (w of ["spear", "sword"]) {
    let n = me.carried[w]
    if (n != null && n > 0) { return true }
  }
  return false
}

// At whoever struck me, while they are in sight.
fn fightBack() {
  let foe = null
  for (r of residents()) {
    if (r.id == me.struckBy) { foe = r }
  }
  if (foe == null) {
    if (!backToCarriage()) { end("the attacker is gone") }
    return
  }
  let o = me.order
  if (o != null && o.kind == "attack" && o.targetId == foe.id) { return } // at it
  let problem = attack(foe.id)
  if (problem != null) {
    if (!backToCarriage()) { end("can't fight back: " + problem) }
    return
  }
  doing("Defending: fighting back at " + foe.name)
  log("fighting back at " + foe.name)
}

// The fight led me off my carriage: back to it, for my drive to go on. True
// until I am there; false if I can't get there.
fn backToCarriage() {
  if (memory.carriageId == null) { return false }
  for (c of carriages()) {
    if (c.id == memory.carriageId) {
      if (c.x == me.x && c.y == me.y) { return false }
      if (me.order != null && me.order.kind == "walkTo") { return true } // on my way
      if (walkTo(c.x, c.y) != null) { return false }
      doing("Defending: back to the carriage")
      log("back to " + placeName(c))
      return true
    }
  }
  return false
}

// Home to my city's town hall, until I am there or it has been calm.
fn fleeHome() {
  if (me.struckAt == null || tick - me.struckAt >= calm) {
    end("no blow for a while")
    return
  }
  let hall = townHall()
  if (hall == null) {
    end("no home to flee to")
    return
  }
  let here = buildingAt(me.x, me.y)
  if (here != null && here.id == hall.id) {
    end("home")
    return
  }
  if (me.order != null && me.order.kind == "walkTo") { return } // on my way
  let problem = walkTo(hall.x, hall.y)
  if (problem != null) {
    end("can't flee home: " + problem)
    return
  }
  doing("Defending: fleeing home")
  log("fleeing home to " + placeName(hall))
}

// My city's town hall, if I see my city.
fn townHall() {
  for (c of cities()) {
    if (c.id == me.cityId) { return building(c.townHallId) }
  }
  return null
}

// A building or carriage for my log: "the storage at 12,6".
fn placeName(b) {
  let kind = b.kind
  if (kind == null) { kind = "carriage" }
  return "the " + kind + " at " + b.x + "," + b.y
}

// The units of goods in load for my log: "10 stone, 4 wood".
fn goodsText(load, goods) {
  let text = ""
  for (g of goods) {
    let n = load[g]
    if (n != null && n >= 1) {
      if (text != "") { text = text + ", " }
      text = text + floor(n) + " " + g
    }
  }
  return text
}
"#,
    ),
    (
        Task::Train,
        "Train",
        r#"// Train (default): train at params.ground, or while none is picked the
// training ground I stand on when I start, kept in memory.groundId; with
// none, or once it is gone, I end. Away from it I walk there first. With
// memory.subject set, I end once the ground teaches something else. While
// no teacher is there, or I have learned all the teacher can teach me, I
// wait there. Meals come from the ground's pile on their own, without an
// order. Below params.foodAt units of Food on me I get Food up to
// params.foodTake at the nearest storage of my realm with Food, and come
// back. foodAt 0 turns getting food off.
param ground: building // the training ground; none: the one I stand on
param foodAt: number = 1 // get Food below this many units on me; 0 never
param foodTake: number = 3 // units of Food to take along

if (!pickGround()) { return }
let ground = building(memory.groundId)
// Kept for when it is out of sight.
if (ground != null) { memory.at = {x: ground.x, y: ground.y} }
if (memory.at == null && params.ground != null) {
  memory.at = {x: params.ground.x, y: params.ground.y}
}
if (memory.at == null || memory.stuck) { return }
if (me.order != null && me.order.kind != "train") { return } // on my way

if (walkBack()) { return }
if (ground == null) { // here, and it isn't: torn down
  end("the training ground is gone")
  return
}
if (memory.subject != null && ground.subject != null && ground.subject != memory.subject) {
  end("the ground teaches " + ground.subject + ", not " + memory.subject)
  return
}
// With no Food anywhere, I train on.
if (getFoodIfLow(null, ground)) { return }
if (me.order == null) {
  let problem = train()
  if (problem != null) { end(problem) }
  return
}
if (ground.teacher == null) { doing("Waiting for a teacher") }
else if (me.order.learning == null) { doing("Waiting: learned all I can here") }
else { doing(null) } // the order says what I learn

// Which ground I train at: the one picked, else the one I started on, kept in
// memory.groundId. False once I end: neither is a training ground.
fn pickGround() {
  if (params.ground != null) {
    if (!isGround(params.ground)) {
      end("the " + params.ground.kind + " is no training ground")
      return false
    }
    memory.groundId = params.ground.id
  }
  if (memory.groundId == null) {
    let here = buildingAt(me.x, me.y)
    if (!isGround(here)) {
      end("no training ground on their tile")
      return false
    }
    memory.groundId = here.id
  }
  return true
}

// A finished training ground.
fn isGround(b) {
  return b != null && b.kind == "trainingGround" && b.site == null
}

// Off the ground (not there yet, or back from getting food): walk to it,
// once; with no way there I stay put. True until I am on it.
fn walkBack() {
  let here = buildingAt(me.x, me.y)
  if (here != null && here.id == memory.groundId) {
    if (memory.walked != null) { memory.walked = null }
    return false
  }
  if (memory.walked == true) {
    memory.stuck = true
    log("no way to the training ground")
  } else {
    memory.walked = true
    walkTo(memory.at.x, memory.at.y)
  }
  return true
}

// Getting food: below params.foodAt units of Food on me, fetch Food up to
// params.foodTake at from while it holds Food, else at the nearest storage of
// my realm with Food from near. True once I set off, which I log; I wait
// until I have it.
fn getFoodIfLow(from, near) {
  let food = me.carried.food
  if (food == null) { food = 0 }
  if (food >= params.foodAt) { return false }
  let units = floor(params.foodTake - food) // fetch takes whole units
  if (units < 1) { return false }
  let at = from
  if (at == null || !holdsFood(at)) {
    at = null
    let stores = storages(near, ["food"]) // nearest first, holding some
    if (stores.length > 0) { at = stores[0] }
  }
  if (at == null || fetch({food: units}, at.id) != null) { return false }
  wait() // until I have it
  log("low on Food (" + floor(food) + "): fetching " + units + " at " + placeName(at))
  return true
}

// Whether a storage, or a carriage, holds a whole unit of Food to fetch.
fn holdsFood(at) {
  let held = at.stock
  if (held == null) { held = at.load } // a carriage
  return held != null && held.food != null && held.food >= 1
}

// The Food that tops me up to params.foodTake, in whole units.
fn foodToTake() {
  let food = me.carried.food
  if (food == null) { food = 0 }
  let units = floor(params.foodTake - food)
  if (units < 1) { return 0 }
  return units
}

// A building or carriage for my log: "the storage at 12,6".
fn placeName(b) {
  let kind = b.kind
  if (kind == null) { kind = "carriage" }
  return "the " + kind + " at " + b.x + "," + b.y
}

// The units of goods in load for my log: "10 stone, 4 wood".
fn goodsText(load, goods) {
  let text = ""
  for (g of goods) {
    let n = load[g]
    if (n != null && n >= 1) {
      if (text != "") { text = text + ", " }
      text = text + floor(n) + " " + g
    }
  }
  return text
}
"#,
    ),
    (
        Task::BuildLine,
        "Build line",
        r#"// Build line (default): build memory.line.building, road or wall, on each
// tile of the line from memory.line.from to memory.line.to, straight or
// diagonal, as the Build line order gives it; started without one I end.
// Tiles that have one already, or can't take one, are skipped. I take the
// nearest tile still to build that no other of us on this line has taken,
// walk there, lay out its site or join the one there, and build it; with
// every tile left taken I wait for the others to finish the line. What I
// carry goes in first; lacking some, I fetch from params.source, or the
// nearest storage of my realm holding them while none is picked, as much as
// I can carry for this tile and my share of the next ones, topping my food
// up to params.foodTake there. With none in any storage I
// lay out each tile's site and go on to the next; once all are laid out I
// end, saying why. Below params.foodAt units of Food on me I get Food up to
// params.foodTake at params.food, else params.source, else the nearest
// storage of my realm with Food, and come back. foodAt 0 turns getting food
// off.
param source: storage // where materials come from; a carriage too; none: the nearest storage holding some
param food: storage // where Food comes from; a carriage too; none: my source, else the nearest storage with Food
param foodAt: number = 1 // get Food below this many units on me; 0 never
param foodTake: number = 3 // units of Food to take along

if (memory.line == null) {
  end("no line given")
  return
}
if (me.order != null && me.order.kind != "build") { // on my way
  wait()
  return
}

let tiles = lineTiles(memory.line, me) // nearest first
let crew = withMemory("line", memory.line) // all of us on this line, me too
let taken = takenByOthers(crew)
if (me.order == null) {
  let tile = pickTile(tiles, taken)
  if (tile == null) {
    endLine(tiles)
    return
  }
  memory.waiting = null
  if (walkThere(tile)) { return }
  // With no Food anywhere, I build on.
  if (getFoodIfLow(params.food || params.source, me)) { return }
  startBuilding(tile)
  return
}
if (me.order.siteId == null) { return } // laid out at the end of the tick
let site = building(me.order.siteId)
if (site == null || bringCarried(site)) { return }
if (getFoodIfLow(params.food || params.source, me)) { return }
fetchMissing(site, tiles, crew, taken)

// The tiles others of us on this line have taken, by "x,y".
fn takenByOthers(crew) {
  let taken = {}
  for (r of crew) {
    let at = r.script.memory.at
    if (r.id != me.id && at != null) { taken[at.x + "," + at.y] = true }
  }
  return taken
}

// The tile I build next, kept in memory.at: the nearest still to build that
// no other of us has taken, and while no storage holds materials the nearest
// not laid out yet. Null once there is none.
fn pickTile(tiles, taken) {
  for (t of tiles) {
    if ((memory.noStock == null || t.siteId == null) && taken[t.x + "," + t.y] == null) {
      memory.at = {x: t.x, y: t.y}
      return t
    }
  }
  memory.at = null
  return null
}

// No tile left to take: the line is built, every tile left is taken by
// others of us, or every tile left is laid out and still no storage holds
// materials. With others building the rest I wait for them to finish it;
// with materials there again, I go on.
fn endLine(tiles) {
  if (tiles.length == 0) {
    log("the " + memory.line.building + " line is finished")
    end()
  } else if (memory.noStock == null) {
    if (memory.waiting == null) {
      log("the rest of the line is taken: waiting for it to be finished")
      memory.waiting = true
    }
  } else if (materialsFrom(me, memory.noStock) != null) {
    log("there is " + goodsNames(memory.noStock) + " again: building the laid-out sites")
    memory.noStock = null
  } else {
    end("no " + goodsNames(memory.noStock) + " in any storage")
  }
}

// Not on the tile yet: walk there, once. True until I am there; with no way
// there I end.
fn walkThere(tile) {
  if (me.x == tile.x && me.y == tile.y) {
    memory.walkedTo = null
    return false
  }
  let walked = memory.walkedTo
  if (walked != null && walked.x == tile.x && walked.y == tile.y) {
    end("no way to " + tile.x + "," + tile.y)
    return true
  }
  memory.walkedTo = {x: tile.x, y: tile.y}
  let problem = walkTo(tile.x, tile.y)
  if (problem == null) { wait() } // until I am there
  else { end("can't walk to " + tile.x + "," + tile.y + ": " + problem) }
  return true
}

// Laying out the tile's site, or joining the one there. Turned down, I end
// saying why.
fn startBuilding(tile) {
  let problem = build(memory.line.building)
  if (problem != null) {
    end("can't build at " + tile.x + "," + tile.y + ": " + problem)
  } else if (tile.siteId == null) {
    log("laying out a " + memory.line.building + " at " + tile.x + "," + tile.y)
  }
}

// What I carry of what the site lacks goes in first. True once I drop it.
fn bringCarried(site) {
  let needed = materialsNeeded(site)
  let mine = carriedOf(me, needed)
  if (mine == null) { return false }
  drop({kind: "site", siteId: site.id}, mine)
  log("bringing " + goodsText(mine, goodsOf(needed)) + " to the site")
  return true
}

// Lacking materials for my tile: fetch them from params.source, or the
// nearest storage holding them, for this tile and my share of the next ones
// nobody has taken, as much as I can carry, with my food topped up to
// params.foodTake. With none in any storage I leave the site laid out and go
// on to the next tile.
fn fetchMissing(site, tiles, crew, taken) {
  let missing = materialsNeeded(site)
  if (missing.length == 0) { return }
  let goods = goodsOf(missing)
  let from = materialsFrom(site, goods)
  if (from == null) {
    if (memory.noStock == null) {
      log("no " + goodsNames(goods) + " in any storage: laying out the rest of the line")
    }
    memory.noStock = goods
    stop()
    return
  }
  memory.noStock = null
  let load = {}
  let topUp = foodToTake()
  if (topUp > 0) { load.food = topUp }
  // My share of the next tiles still to build that no other of us has taken.
  let free = 0
  for (t of tiles) {
    if (taken[t.x + "," + t.y] == null) { free = free + 1 }
  }
  let more = floor((free - 1) / crew.length)
  for (m of missing) {
    let perTile = m.units // what a tile takes: what this one lacks and has
    let had = site.site.delivered[m.good]
    if (had != null) { perTile = perTile + had }
    let units = m.units + perTile * more
    let room = fits(m.good)
    if (units > room) { units = room }
    load[m.good] = units
  }
  if (fetch(load, from.id) == null) {
    wait() // until I have it
    log("fetching " + goodsText(load, goods) + " at " + placeName(from))
  }
}

// Where materials come from: params.source while it holds some of goods,
// else, while none is picked, the nearest storage of my realm holding some.
fn materialsFrom(near, goods) {
  let from = params.source
  if (from == null) {
    let stores = storages(near, goods) // nearest first, holding some
    if (stores.length == 0) { return null }
    return stores[0]
  }
  let held = from.stock
  if (held == null) { held = from.load } // a carriage
  if (held == null) { return null }
  for (g of goods) {
    if (held[g] != null && held[g] > 0) { return from }
  }
  return null
}

// What someone carries of what the site lacks; null if nothing.
fn carriedOf(r, missing) {
  let load = null
  for (m of missing) {
    let n = r.carried[m.good]
    if (n != null && n > 0) {
      if (n > m.units) { n = m.units }
      if (load == null) { load = {} }
      load[m.good] = n
    }
  }
  return load
}

// The goods of what the site lacks.
fn goodsOf(missing) {
  let goods = []
  for (m of missing) { goods[goods.length] = m.good }
  return goods
}

// Goods by name for my log: "stone", or "wood and stone".
fn goodsNames(goods) {
  let text = ""
  for (g of goods) {
    if (text != "") { text = text + " and " }
    text = text + g
  }
  return text
}

// Getting food: below params.foodAt units of Food on me, fetch Food up to
// params.foodTake at from while it holds Food, else at the nearest storage of
// my realm with Food from near. True once I set off, which I log; I wait
// until I have it.
fn getFoodIfLow(from, near) {
  let food = me.carried.food
  if (food == null) { food = 0 }
  if (food >= params.foodAt) { return false }
  let units = floor(params.foodTake - food) // fetch takes whole units
  if (units < 1) { return false }
  let at = from
  if (at == null || !holdsFood(at)) {
    at = null
    let stores = storages(near, ["food"]) // nearest first, holding some
    if (stores.length > 0) { at = stores[0] }
  }
  if (at == null || fetch({food: units}, at.id) != null) { return false }
  wait() // until I have it
  log("low on Food (" + floor(food) + "): fetching " + units + " at " + placeName(at))
  return true
}

// Whether a storage, or a carriage, holds a whole unit of Food to fetch.
fn holdsFood(at) {
  let held = at.stock
  if (held == null) { held = at.load } // a carriage
  return held != null && held.food != null && held.food >= 1
}

// The Food that tops me up to params.foodTake, in whole units.
fn foodToTake() {
  let food = me.carried.food
  if (food == null) { food = 0 }
  let units = floor(params.foodTake - food)
  if (units < 1) { return 0 }
  return units
}


// A building or carriage for my log: "the storage at 12,6".
fn placeName(b) {
  let kind = b.kind
  if (kind == null) { kind = "carriage" }
  return "the " + kind + " at " + b.x + "," + b.y
}

// The units of goods in load for my log: "10 stone, 4 wood".
fn goodsText(load, goods) {
  let text = ""
  for (g of goods) {
    let n = load[g]
    if (n != null && n >= 1) {
      if (text != "") { text = text + ", " }
      text = text + floor(n) + " " + g
    }
  }
  return text
}
"#,
    ),
    (
        Task::Explore,
        "Explore",
        r#"// Explore (default): go into the unknown. I walk to the edge of what my
// Player has explored, the nearest tile first: toward params.toward, or the
// nearest to params.waypoint; with neither, the nearest to me. Standing
// there I see past it. I set out with as much Food as I can carry, from
// params.food while it holds Food, else the nearest storage of my realm
// with Food. Before each way out I check the Food on me covers it and the
// way back to that storage, plus margin units; riding, my horse eats from
// it too. Once it doesn't, I turn back, refill there and go back out to
// where I turned. With no edge left in reach, I walk back there and end.
// With params.find, I look about each tick on my way out, and at every
// stop: once my Player sees a node of that kind that none of their
// waypoints marks, I put a waypoint on it ("Gold ore node"), walk back to
// where I refill and end. Without it I go on until stopped.
param find: choice(forest, stone, ironOre, goldOre) // the node to find; none: just explore
param toward: choice(north, northeast, east, southeast, south, southwest, west, northwest) // the way to go; none: the nearest unexplored tiles first
param waypoint: waypoint // a waypoint to head for instead; none: go by toward
param food: storage // where to refill; a carriage too; none: the nearest storage with Food
let margin = 3 // units of Food kept beyond the way back
let skipMax = 10 // tiles with no way there that I keep leaving out

if (params.find != null && memory.ending == null && found()) { return }
if (me.order != null) { // on my way
  if (params.find != null && memory.target != null) { return } // out: I look about each tick
  wait()
  return
}
if (memory.ending != null) { // back where I refill
  end(memory.ending)
  return
}
if (memory.skip == null) { memory.skip = [] }
if (memory.fetching != null) {
  if (!refilled()) { return }
} else if (memory.target != null) {
  arrived()
}
let from = foodFrom()
if (from == null) {
  end("no Food to explore with")
  return
}
if (memory.turnedAt != null && goBackOut(from)) { return }
let edge = nextEdge()
if (edge == null) {
  endBack("nothing unexplored in reach", from)
} else if (memory.out != true && memory.full != true && fits("food") >= 1) {
  turnBack(from) // setting out
} else if (covers(edge, from)) {
  walkOut(edge)
} else if (memory.full == true) { // refilled, and still short
  endBack("nothing unexplored in reach of the Food I can carry", from)
} else {
  turnBack(from)
}

// The edge to walk to next, leaving out tiles I found no way to.
fn nextEdge() {
  if (params.waypoint != null) { return exploredEdge(params.waypoint, null, memory.skip) }
  return exploredEdge(me, params.toward, memory.skip)
}

// Whether the Food on me covers the way to a tile and from there back to
// where I refill, plus margin.
fn covers(to, from) {
  return foodOnMe() >= wayFood(me, to) + wayFood(to, from) + margin
}

fn walkOut(edge) {
  let problem = walkTo(edge.x, edge.y)
  if (problem != null) {
    end("can't walk out: " + problem)
    return
  }
  memory.target = {x: edge.x, y: edge.y}
  memory.out = true
  memory.full = null
  waitOut() // until I am there
}

// Fetch as much Food as fits where I refill: setting out, or turning back
// once I have been out.
fn turnBack(from) {
  let units = fits("food")
  let problem = fetch(["food"], from.id) // as much as fits
  if (problem != null) {
    end("can't fetch Food: " + problem)
    return
  }
  memory.fetching = true
  if (memory.out == true) {
    memory.turnedAt = {x: me.x, y: me.y}
    log("turning back with " + floor(foodOnMe()) + " Food to " + placeName(from))
  } else {
    log("setting out: fetching " + units + " Food at " + placeName(from))
  }
  wait() // until I have it
}

// On my way out: with params.find I run each tick to look about, else I
// wait till I am there.
fn waitOut() {
  if (params.find == null) { wait() }
}

// A node of the kind params.find asks for that my Player sees and none of
// their waypoints marks: I put a waypoint on it and walk back to end. True
// once I found one.
fn found() {
  let node = unmarked(nodesInSight(params.find))
  if (node == null) { return false }
  let name = nodeName(node.kind)
  let reason = "found a " + name + " at " + node.x + "," + node.y
  let problem = addWaypoint(node.x, node.y, name)
  if (problem != null) {
    log("no waypoint: " + problem)
    reason = reason + ", no waypoint added"
  }
  log(reason)
  memory.target = null
  memory.fetching = null
  memory.turnedAt = null
  let from = foodFrom()
  if (from == null) {
    end(reason)
  } else {
    endBack(reason, from)
  }
  return true
}

// The first of nodes with none of my Player's waypoints on its tile; null
// with none.
fn unmarked(nodes) {
  if (nodes.length == 0) { return null }
  let marked = {}
  for (w of waypoints()) { marked[w.x + "," + w.y] = true }
  for (n of nodes) {
    if (marked[n.x + "," + n.y] == null) { return n }
  }
  return null
}

// A waypoint's name for a node: "Gold ore node".
fn nodeName(kind) {
  if (kind == "ironOre") { return "Iron ore node" }
  if (kind == "goldOre") { return "Gold ore node" }
  if (kind == "forest") { return "Forest node" }
  return "Stone node"
}

// Done: back where I refill first, so I never end out in the wild, then
// end saying why.
fn endBack(reason, from) {
  let here = buildingAt(me.x, me.y)
  let there = (here != null && here.id == from.id) || (me.x == from.x && me.y == from.y)
  if (there || walkTo(from.x, from.y) != null) {
    end(reason)
    return
  }
  memory.ending = reason
  log("done: walking back to " + placeName(from))
  wait() // until I am there
}

// Back from fetching Food: false once I end, as I couldn't.
fn refilled() {
  memory.fetching = null
  let ended = me.orderEnded
  if (ended != null && ended.kind == "fetch" && ended.reason != null) {
    end("can't refill: " + ended.reason)
    return false
  }
  memory.full = true
  return true
}

// Refilled: back out to where I turned, while the Food on me covers it.
// True once I set off; otherwise I explore from here.
fn goBackOut(from) {
  let at = memory.turnedAt
  memory.turnedAt = null
  if ((me.x == at.x && me.y == at.y) || !covers(at, from)) { return false }
  if (walkTo(at.x, at.y) != null) { return false }
  memory.target = {x: at.x, y: at.y}
  memory.full = null
  log("going back out to " + at.x + "," + at.y)
  waitOut() // until I am there
  return true
}

// My walk out ended. Short of the tile there was no way there: I leave it,
// and the tiles near it, out from now on.
fn arrived() {
  let t = memory.target
  memory.target = null
  if (me.x == t.x && me.y == t.y) { return }
  let i = memory.skipNext
  if (i == null) { i = 0 }
  memory.skip[i] = {x: t.x, y: t.y}
  memory.skipNext = (i + 1) % skipMax
  log("no way to " + t.x + "," + t.y + ": leaving it out")
}

// Where I refill: params.food while it holds Food, else the nearest storage
// of my realm with Food; null with none.
fn foodFrom() {
  if (params.food != null && holdsFood(params.food)) { return params.food }
  let stores = storages(me, ["food"]) // nearest first, holding some
  if (stores.length > 0) { return stores[0] }
  return null
}

// Whether a storage, or a carriage, holds a whole unit of Food to fetch.
fn holdsFood(at) {
  let held = at.stock
  if (held == null) { held = at.load } // a carriage
  return held != null && held.food != null && held.food >= 1
}

fn foodOnMe() {
  let food = me.carried.food
  if (food == null) { return 0 }
  return food
}

// A building or carriage for my log: "the storage at 12,6".
fn placeName(b) {
  let kind = b.kind
  if (kind == null) { kind = "carriage" }
  return "the " + kind + " at " + b.x + "," + b.y
}

// The units of goods in load for my log: "10 stone, 4 wood".
fn goodsText(load, goods) {
  let text = ""
  for (g of goods) {
    let n = load[g]
    if (n != null && n >= 1) {
      if (text != "") { text = text + ", " }
      text = text + floor(n) + " " + g
    }
  }
  return text
}
"#,
    ),
    (
        Task::Alarm,
        "Alarm",
        r#"// Alarm (default): what I do when an alarm reaches me, in place of what I was
// doing, which goes on once I end. Armed, with the town hall occupied, I go
// after the occupier while they stand in the city's area, and end once no armed
// one of theirs is left there or in sight. For a theft I go after the thief, and
// with a wall or neighbour attacked the attacker, until they are dead or have left
// the area or sight. Striking someone occupying the hall, or a thief I know of, is
// no crime in my own city's area, nor is striking back at an attacker; striking
// anyone else is. For an armed outsider in the area I walk to the town hall and
// stand there until no armed outsider is left, which blocks an occupation before
// it starts; an unarmed outsider I only log. A theft, an attack or an occupation
// takes me off the hall, and when I end for it I come back here while armed
// outsiders remain. Unarmed, or for another alarm, I end at once.
if (me.alarm == null || !armed(me)) {
  end()
} else if (me.alarm.kind == "occupied") {
  let foe = occupier()
  if (foe == null) {
    end("the occupier is gone")
  } else {
    memory.foeId = foe.id
    goAfter(foe)
  }
} else if (me.alarm.kind == "theft") {
  goAfterCulprit("the thief is gone")
} else if (me.alarm.kind == "attacked") {
  goAfterCulprit("the attacker is gone")
} else if (me.alarm.kind == "outsider") {
  onOutsider()
} else {
  end()
}

// Who came decides whether I go at all; once I do, any armed outsider keeps me.
fn onOutsider() {
  let about = null
  let armedLeft = false
  for (r of outsidersIn(me.alarm.cityId)) {
    if (r.id == me.alarm.about) { about = r }
    if (armed(r)) { armedLeft = true }
  }
  if (memory.holding == null) {
    if (about == null) {
      end()
      return
    }
    if (!armed(about)) {
      log(about.name + " came into the area, unarmed")
      end()
      return
    }
    memory.holding = true
  }
  if (!armedLeft) {
    end("no armed outsider left in the area")
    return
  }
  holdHall()
}

// To the town hall of the alarm's city, and stay there.
fn holdHall() {
  let hall = null
  for (c of cities()) {
    if (c.id == me.alarm.cityId) { hall = building(c.townHallId) }
  }
  if (hall == null) {
    end("no town hall to hold")
    return
  }
  let here = buildingAt(me.x, me.y)
  if (here != null && here.id == hall.id) {
    doing("On alarm: holding the town hall")
    return
  }
  if (me.order != null && me.order.kind == "walkTo") { return } // on my way
  let problem = walkTo(hall.x, hall.y)
  if (problem != null) {
    end("can't reach the town hall: " + problem)
    return
  }
  doing("On alarm: going to hold the town hall")
  log("going to hold " + placeName(hall))
}

fn goAfterCulprit(goneText) {
  let foe = culprit()
  if (foe == null) {
    end(goneText)
  } else {
    goAfter(foe)
  }
}

fn goAfter(foe) {
  let o = me.order
  if (o != null && o.kind == "attack" && o.targetId == foe.id) { return } // at it
  let problem = attack(foe.id)
  if (problem != null) {
    end("can't go after " + foe.name + ": " + problem)
    return
  }
  doing("On alarm: going after " + foe.name)
  log("going after " + foe.name)
}

// The occupier I am after while they stand in the area, else another armed one
// of theirs there.
fn occupier() {
  let after = memory.foeId
  if (after == null) { after = me.alarm.about }
  let realm = me.alarm.realmId
  let other = null
  for (r of residents()) {
    if (r.owner == realm || r.id == after) {
      if (armed(r) && inCityArea(me.alarm.cityId, r.x, r.y)) {
        if (r.id == after) { return r }
        other = r
      }
    }
  }
  return other
}

// Who the alarm is about, while I see them in the city's area.
fn culprit() {
  for (r of residents()) {
    if (r.id == me.alarm.about && inCityArea(me.alarm.cityId, r.x, r.y)) { return r }
  }
  return null
}

// Whether they carry a weapon.
fn armed(who) {
  for (w of ["spear", "sword"]) {
    let n = who.carried[w]
    if (n != null && n > 0) { return true }
  }
  return false
}

// A building or carriage for my log: "the storage at 12,6".
fn placeName(b) {
  let kind = b.kind
  if (kind == null) { kind = "carriage" }
  return "the " + kind + " at " + b.x + "," + b.y
}

// The units of goods in load for my log: "10 stone, 4 wood".
fn goodsText(load, goods) {
  let text = ""
  for (g of goods) {
    let n = load[g]
    if (n != null && n >= 1) {
      if (text != "") { text = text + ", " }
      text = text + floor(n) + " " + g
    }
  }
  return text
}
"#,
    ),
];

//! The views of a resident, an army and what belongs to them.

use csp_shared::goods::{PROTECTION_KINDS, WEAPONS};
use csp_shared::world::Good;

use crate::script_tables::names_text;
use crate::script_views::{ScriptField, ScriptType, ScriptView};

/// A field for each good: how many units of it there are.
const GOODS_FIELDS: [ScriptField; Good::ALL.len()] = {
    const BLANK: ScriptField = ScriptField {
        name: "",
        r#type: ScriptType::Number,
        description: "",
        null_when: Some("when there are none"),
    };
    let mut fields = [BLANK; Good::ALL.len()];
    let mut i = 0;
    while i < fields.len() {
        fields[i].name = Good::ALL[i].name();
        fields[i].description = Good::ALL[i].spec().script_text;
        i += 1;
    }
    fields
};

pub(super) const RESIDENTS: &[ScriptView] = &[
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
                description: "The goods they carry: seen of your own and your allies' residents, and of anyone one of yours stands beside; empty for others, who show only what they have equipped.",
                null_when: None,
            },
            ScriptField {
                name: "equipped",
                r#type: ScriptType::View("equipment"),
                description: "What they have equipped: a weapon, shield and armour, each among what they carry.",
                null_when: None,
            },
            ScriptField {
                name: "condition",
                r#type: ScriptType::View("condition"),
                description: "The condition of what they have equipped.",
                null_when: Some("for another realm’s residents"),
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
                description: "The id of the carriage or boat they are aboard as a passenger.",
                null_when: Some("unless they are aboard one"),
            },
            ScriptField {
                name: "up",
                r#type: ScriptType::Boolean,
                description: "Whether they are up on a wall walk, on top of a wall or gate, rather than on the ground. Getting up or down takes a while, and they come down only on the side they went up from.",
                null_when: None,
            },
            ScriptField {
                name: "reach",
                r#type: ScriptType::Number,
                description: "How far, in tiles, their Bow or Crossbow shoots from where they stand: further up on a wall. The Arrows they shoot are `carried.arrows`; out of them they fight with their fists.",
                null_when: Some("without a bow or crossbow equipped"),
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
        name: "equipment",
        description: "A resident’s three equipment slots: the good in each. Only what is equipped counts in a fight, and a weapon equipped makes them armed.",
        fields: &[
            ScriptField {
                name: "weapon",
                r#type: ScriptType::String,
                description: names_text!("The weapon equipped: ", WEAPONS, ". A bow or crossbow takes both hands, so the shield slot stays empty."),
                null_when: Some("when unarmed"),
            },
            ScriptField {
                name: "shield",
                r#type: ScriptType::String,
                description: names_text!("The shield equipped: ", PROTECTION_KINDS[0], "."),
                null_when: Some("when they have none equipped"),
            },
            ScriptField {
                name: "armour",
                r#type: ScriptType::String,
                description: names_text!("The armour equipped: ", PROTECTION_KINDS[1], "."),
                null_when: Some("when they have none equipped"),
            },
        ],
    },
    ScriptView {
        name: "condition",
        description: "The condition of what a resident has equipped: \"good\", \"worn\" or \"nearlyBroken\". Gear wears with each blow struck or taken and a little in training; worn out, it breaks and is gone. It fights as well as new until then.",
        fields: &[
            ScriptField {
                name: "weapon",
                r#type: ScriptType::String,
                description: "The equipped weapon's condition.",
                null_when: Some("when unarmed"),
            },
            ScriptField {
                name: "shield",
                r#type: ScriptType::String,
                description: "The equipped shield's condition.",
                null_when: Some("when they have none equipped"),
            },
            ScriptField {
                name: "armour",
                r#type: ScriptType::String,
                description: "The equipped armour's condition.",
                null_when: Some("when they have none equipped"),
            },
            ScriptField {
                name: "tools",
                r#type: ScriptType::String,
                description: "The condition of the set of Tools they work with: it wears with each day's work.",
                null_when: Some("when they carry none"),
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
            ScriptField {
                name: "seafaring",
                r#type: ScriptType::Number,
                description: "How far they have learned seafaring, by rowing.",
                null_when: Some("until they start learning it"),
            },
        ],
    },
    ScriptView {
        name: "goods",
        description: "Goods by kind, in units, like {food: 3, wood: 10}.",
        fields: &GOODS_FIELDS,
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
];

//! The views of horses, carriages, vessels and siege machines.

use crate::script_views::{ScriptField, ScriptType, ScriptView};

pub(super) const TRANSPORT: &[ScriptView] = &[
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
        description: "A boat or ship on the water, as the Player sees it.",
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
                description: "What it is: \"boat\" or \"ship\".",
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
            ScriptField {
                name: "passengerIds",
                r#type: ScriptType::List(&ScriptType::String),
                description: "The residents aboard it as passengers.",
                null_when: None,
            },
            ScriptField {
                name: "rowerId",
                r#type: ScriptType::String,
                description: "The one aboard at its oars, who rows it or rowed it last; no passenger.",
                null_when: Some("when nobody is at its oars"),
            },
        ],
    },
    ScriptView {
        name: "machine",
        description: "A siege machine in the field, as the Player sees it.",
        fields: &[
            ScriptField {
                name: "id",
                r#type: ScriptType::String,
                description: "The machine’s id, unique in the world.",
                null_when: None,
            },
            ScriptField {
                name: "kind",
                r#type: ScriptType::String,
                description: "What it is: \"ram\".",
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
                name: "damage",
                r#type: ScriptType::Number,
                description: "The damage blows have done it; at its strength it breaks.",
                null_when: Some("while it is unharmed"),
            },
            ScriptField {
                name: "teardown",
                r#type: ScriptType::Number,
                description: "The work put into tearing it down so far.",
                null_when: Some("while nobody has started"),
            },
            ScriptField {
                name: "crewIds",
                r#type: ScriptType::List(&ScriptType::String),
                description: "Its crew on its tile, in the order they joined.",
                null_when: None,
            },
            ScriptField {
                name: "pusherId",
                r#type: ScriptType::String,
                description: "The one of its crew pushing it now.",
                null_when: Some("while it stands still"),
            },
        ],
    },
];

//! The views of directives, materials, lines, waypoints, realms and demands.

use crate::script_views::{ScriptField, ScriptType, ScriptView};

pub(super) const REALM: &[ScriptView] = &[
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
            ScriptField {
                name: "building",
                r#type: ScriptType::String,
                description: "What is built there: the line's \"road\" or \"wall\", or \"gate\" where a stone wall line upgrades a wooden gate.",
                null_when: None,
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
        name: "realm",
        description: "A realm, as the Player sees it.",
        fields: &[
            ScriptField {
                name: "id",
                r#type: ScriptType::String,
                description: "The realm’s id, unique in the world.",
                null_when: None,
            },
            ScriptField {
                name: "heir",
                r#type: ScriptType::String,
                description: "The id of the resident named to carry the realm on.",
                null_when: Some("while my realm has none named, and always for another realm"),
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
            ScriptField {
                name: "wavering",
                r#type: ScriptType::Number,
                description: "For a demand to an NPC city: while the sender’s force near it far outweighs it, the ticks left before it gives in. It starts again from nothing after a planning pass it doesn’t.",
                null_when: Some("the sender’s force doesn’t far outweigh the city now, or it was sent to anyone else"),
            },
        ],
    },
];

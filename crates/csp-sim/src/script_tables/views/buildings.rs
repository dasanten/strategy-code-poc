//! The views of a building, its settings, a construction site and its price.

use crate::script_views::{ScriptField, ScriptType, ScriptView};

pub(super) const BUILDINGS: &[ScriptView] = &[
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
                name: "material",
                r#type: ScriptType::String,
                description: "\"stone\" for a stone wall or gate, or its site.",
                null_when: Some("for one of wood and any other building"),
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
            ScriptField {
                name: "vein",
                r#type: ScriptType::String,
                description: "How the vein of a workplace on a node stands: \"plenty\", \"thinning\", \"nearlyGone\", or \"endless\" for a node that never runs dry; never a number.",
                null_when: Some("for any other building, a construction site, a mine whose vein ran dry, and while neither my realm nor an ally has a resident working it"),
            },
            ScriptField {
                name: "condition",
                r#type: ScriptType::String,
                description: "How it has decayed: \"good\", \"worn\", \"nearlyRuin\" or \"ruin\"; a worn one, or worse, can be repaired (`repair`), and repairing a ruin rebuilds it.",
                null_when: Some("for a construction site and a building that never decays"),
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
];

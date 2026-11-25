//! The views of piles, nodes and what was last seen.

use crate::script_views::{ScriptField, ScriptType, ScriptView};

pub(super) const LAND: &[ScriptView] = &[
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
                description: "What it yields: \"forest\", \"stone\", \"ironOre\", \"goldOre\" or \"coal\".",
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
                name: "richness",
                r#type: ScriptType::String,
                description: "How much its workplace makes per worker: \"poor\", \"normal\" or \"rich\".",
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
                name: "material",
                r#type: ScriptType::String,
                description: "\"stone\" for a stone wall or gate, or its site.",
                null_when: Some("for a city, for one of wood and any other building"),
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
];

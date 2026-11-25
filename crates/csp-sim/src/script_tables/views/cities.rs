//! The views of a city, its occupation, its alarm and what it has for hire and sale.

use crate::script_views::{ScriptField, ScriptType, ScriptView};

pub(super) const CITIES: &[ScriptView] = &[
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
                name: "stance",
                r#type: ScriptType::String,
                description: "What an NPC city is after for now: \"grow\", \"fortify\", \"trade\", \"expand\" or \"retaliate\".",
                null_when: Some("for a realm’s city and a city of the Trade Organization"),
            },
            ScriptField {
                name: "retaliatingAgainst",
                r#type: ScriptType::String,
                description: "The name of the Organization an NPC city in Retaliate turned on.",
                null_when: Some("unless its stance is \"retaliate\""),
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
];

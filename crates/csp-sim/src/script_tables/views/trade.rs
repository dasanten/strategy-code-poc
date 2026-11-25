//! The views of traders and offers.

use crate::script_views::{ScriptField, ScriptType, ScriptView};

pub(super) const TRADE: &[ScriptView] = &[
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
];

//! Residents: who they are, their stats and skills, what they wear and carry, and the drifters.
//! What they were told to do is in `orders`, `queue` and `scripts`.

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{
    AlarmScriptId, GivenUnderAttack, Good, Interrupted, OrderEnded, Queue, ResidentOrder,
    RunningScript, ScriptLogLine, ScriptParamValues, Stock, Tile,
};

/// A resident's stats (`STAT_NAMES`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum StatName {
    Strength,
    Endurance,
    Agility,
    Intellect,
}

/// `Record<StatName, T>`: one value per stat.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct StatRecord<T> {
    pub strength: T,
    pub endurance: T,
    pub agility: T,
    pub intellect: T,
}

/// A stat: what the resident was born with, plus what training added.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct Stat {
    pub base: f64,
    pub trained: f64,
}

/// Something learned by doing or training (`SkillName`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum SkillName {
    Mining,
    Woodcutting,
    Smelting,
    Smithing,
    Construction,
    Farming,
    Combat,
    Driving,
    Seafaring,
}

impl SkillName {
    /// The skill's name, as serde writes it.
    pub const fn name(self) -> &'static str {
        match self {
            SkillName::Mining => "mining",
            SkillName::Woodcutting => "woodcutting",
            SkillName::Smelting => "smelting",
            SkillName::Smithing => "smithing",
            SkillName::Construction => "construction",
            SkillName::Farming => "farming",
            SkillName::Combat => "combat",
            SkillName::Driving => "driving",
            SkillName::Seafaring => "seafaring",
        }
    }
}

/// What a training ground teaches (`TrainingSubject`): a stat or a skill.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum TrainingSubject {
    Strength,
    Endurance,
    Agility,
    Intellect,
    Mining,
    Woodcutting,
    Smelting,
    Smithing,
    Construction,
    Farming,
    Combat,
    Driving,
}

/// A person living in the world (`CONTEXT.md`: Resident).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Resident {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub game_name: Option<bool>,
    pub owner: Option<String>,
    pub city_id: Option<String>,
    pub x: f64,
    pub y: f64,
    pub stats: StatRecord<Stat>,
    pub skills: IndexMap<SkillName, f64>,
    pub health: f64,
    pub hunger: f64,
    pub born_at: f64,
    pub lifespan: f64,
    pub carried: Stock,
    /// What the resident has equipped, each item among `carried` (`CONTEXT.md`: Equipment).
    #[serde(default, skip_serializing_if = "Equipment::is_empty")]
    #[ts(as = "Option<Equipment>", optional)]
    pub equipped: Equipment,
    pub order: Option<ResidentOrder>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub order_ended: Option<OrderEnded>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub struck: Option<Struck>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub script: Option<RunningScript>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub interrupted: Option<Interrupted>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub given_under_attack: Option<GivenUnderAttack>,
    /// A script id (see `RunningScript::script_id`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub defence_script_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub alarm_script_id: Option<AlarmScriptId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub script_params: Option<ScriptParamValues>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub script_log: Option<Vec<ScriptLogLine>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub queue: Option<Queue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pair: Option<Pair>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub carrying: Option<Carrying>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub riding: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub aboard: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub down_until: Option<f64>,
    /// Up on the wall walk (`CONTEXT.md`: Wall walk), with the side they came up from, the side
    /// they come down to; on the ground when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub up: Option<UpSide>,
}

/// The side of a wall someone up on its walk came up from, and comes down to again (`CONTEXT.md`:
/// Wall walk): inside its ring, or outside it (either side of a stretch with no inside).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum UpSide {
    Inside,
    Outside,
}

/// A resident's three equipment slots (`CONTEXT.md`: Equipment, ADR 0038): one weapon, one
/// shield and one armour at most, each one of the goods the resident carries. Only what is
/// equipped counts in combat and makes a resident armed.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Equipment {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub weapon: Option<Good>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub shield: Option<Good>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub armour: Option<Good>,
    /// Slots the item was taken off (`CONTEXT.md`: Equipment): each stays empty though the
    /// resident carries something that fits, until they pick up more of what fits.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(skip)]
    pub kept_off: Vec<KeptOff>,
}

impl Equipment {
    /// Whether no slot holds anything and none is kept empty.
    pub fn is_empty(&self) -> bool {
        self.weapon.is_none()
            && self.shield.is_none()
            && self.armour.is_none()
            && self.kept_off.is_empty()
    }
}

/// One of a resident's three equipment slots (`CONTEXT.md`: Equipment).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum EquipSlot {
    Weapon,
    Shield,
    Armour,
}

/// A piece of gear's condition in words (`CONTEXT.md`: Wear).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum PieceCondition {
    Good,
    Worn,
    NearlyBroken,
}

/// The condition of each piece a resident has equipped, an empty slot left out (`CONTEXT.md`:
/// Wear). Only the realm carrying it sees it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GearCondition {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub weapon: Option<PieceCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub shield: Option<PieceCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub armour: Option<PieceCondition>,
    /// The set of Tools they work with (`CONTEXT.md`: Tools), if they carry one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tools: Option<PieceCondition>,
}

/// A slot kept empty after its item was taken off, and how many units fitting it the resident
/// carried then: carrying more of them (picking one up) ends it, and the slot fills at once again.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KeptOff {
    pub slot: EquipSlot,
    pub units: f64,
}

/// Pairing (`CONTEXT.md`: Pairing).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Pair {
    pub partner_id: String,
    pub since: f64,
}

/// Carrying a child (`CONTEXT.md`: Carrying).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Carrying {
    pub since: f64,
    pub partner_id: String,
    pub partner_name: String,
    pub partner_base: StatRecord<f64>,
}

/// Who last struck a resident, and the tick.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct Struck {
    pub by: String,
    pub tick: f64,
}

/// A drifter (`CONTEXT.md`: Drifter): a resident of no Organization walking to the city the
/// Leader of `realm_id` lived in when they set out, to join it on stepping into its area; or,
/// `turned_away`, walking off again until no Player sees them, when they are gone.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Drifter {
    pub resident_id: String,
    pub realm_id: String,
    pub city_id: String,
    /// Where they came into being, and walk back to when turned away.
    pub from: Tile,
    /// The tick they came into being.
    pub set_out_at: f64,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(as = "Option<bool>", optional)]
    pub turned_away: bool,
}

/// What a resident died of (`DeathCause`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum DeathCause {
    Starved,
    OldAge,
    Killed,
    /// Fell from a wall or gate tile that broke under them (`CONTEXT.md`: A tile breaks).
    Fell,
}

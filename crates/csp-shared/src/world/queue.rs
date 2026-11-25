//! A resident's queue: its steps, the if and repeat blocks around them and their conditions.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Good, OrderRequest};

/// A queue (`CONTEXT.md`: Queue, Repeat block; ADR 0032): a tree of steps and repeat blocks,
/// worked through top to bottom.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Queue {
    pub realm_id: String,
    /// The queue's steps and blocks as written, top to bottom.
    pub items: Vec<QueueItem>,
    /// The id of the step being done, or started next, somewhere in `items`.
    pub current: u32,
    pub started_at: Option<f64>,
    pub r#loop: bool,
    /// Ids of steps and blocks, one id space: counted up with `++` only.
    pub next_step_id: u32,
    /// Whether a step started since the queue last began from its top: a looping queue whose
    /// pass started none ends, as a block's empty round does (`CONTEXT.md`: Repeat block).
    #[serde(default, skip_serializing_if = "is_false")]
    #[ts(as = "Option<bool>", optional)]
    pub started: bool,
    /// The name the queue was given under, as a saved queue's (`CONTEXT.md`: Saved queue): the
    /// stable hand's "Farm and feed" (`CONTEXT.md`: Starting city). A queue the Player gives has
    /// none; editing keeps it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
}

fn is_false(b: &bool) -> bool {
    !*b
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

/// One item of a queue: a step, or a repeat block of more.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum QueueItem {
    Step(QueueStep),
    Repeat(RepeatBlock),
    If(IfBlock),
}

impl QueueItem {
    /// The step's or block's id.
    pub fn id(&self) -> u32 {
        match self {
            QueueItem::Step(s) => s.id,
            QueueItem::Repeat(b) => b.id,
            QueueItem::If(b) => b.id,
        }
    }

    /// The lists of items a block holds: a repeat block's items, an If block's items and its
    /// Else part; none for a step.
    pub fn parts(&self) -> Vec<&[QueueItem]> {
        match self {
            QueueItem::Step(_) => vec![],
            QueueItem::Repeat(b) => vec![&b.items],
            QueueItem::If(b) => {
                let mut out: Vec<&[QueueItem]> = vec![&b.items];
                if let Some(e) = &b.r#else {
                    out.push(e);
                }
                out
            }
        }
    }
}

/// A block whose steps run only when its condition holds (`CONTEXT.md`: If block), with an
/// optional Else part run when it doesn't. The condition is checked once, when its turn comes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct IfBlock {
    pub id: u32,
    pub r#if: Condition,
    pub items: Vec<QueueItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub r#else: Option<Vec<QueueItem>>,
    /// The part being run while the current step is inside the block: `then` (`items`) or
    /// `else`; left out otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub branch: Option<Branch>,
}

/// Which part of an If block runs (`IfBlock::branch`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum Branch {
    Then,
    Else,
}

/// Some steps in a row done again and again (`CONTEXT.md`: Repeat block): a count of rounds,
/// forever, or until a condition holds, asked before each round. A round in which none of its
/// steps could start ends it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RepeatBlock {
    pub id: u32,
    pub repeat: Repeat,
    pub items: Vec<QueueItem>,
    /// The round being run, from 1, while the current step is inside the block; 0 (left out)
    /// otherwise.
    #[serde(default, skip_serializing_if = "is_zero")]
    #[ts(as = "Option<u32>", optional)]
    pub round: u32,
    /// Whether a step started in this round.
    #[serde(default, skip_serializing_if = "is_false")]
    #[ts(as = "Option<bool>", optional)]
    pub started: bool,
}

/// How often a repeat block runs: a count of rounds, `"forever"`, or `{ "until": condition }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum Repeat {
    Times(u32),
    Forever(Forever),
    Until(RepeatUntil),
}

/// A Repeat until's condition (`Repeat::Until`, `CONTEXT.md`: Repeat block): asked before each
/// round, the block runs no more rounds once it holds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RepeatUntil {
    pub until: Condition,
}

/// The literal `"forever"` of `Repeat`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum Forever {
    #[serde(rename = "forever")]
    Forever,
}

impl Repeat {
    /// The most rounds the count allows: a Repeat until's count never ends it, its condition
    /// does ([`Repeat::until`]).
    pub fn most(&self) -> u32 {
        match self {
            Repeat::Times(n) => *n,
            Repeat::Forever(_) | Repeat::Until(_) => u32::MAX,
        }
    }

    /// Whether the count allows another round after round `round`.
    pub fn more_after(&self, round: u32) -> bool {
        round < self.most()
    }

    /// A Repeat until's condition.
    pub fn until(&self) -> Option<&Condition> {
        match self {
            Repeat::Until(u) => Some(&u.until),
            _ => None,
        }
    }
}

impl Queue {
    /// The steps top to bottom as written, each once whatever its blocks repeat.
    pub fn steps(&self) -> Vec<&QueueStep> {
        let mut out = Vec::new();
        collect_steps(&self.items, &mut out);
        out
    }

    /// The current step, if `current` names one.
    pub fn current_step(&self) -> Option<&QueueStep> {
        self.steps().into_iter().find(|s| s.id == self.current)
    }

    /// The current step's place among the steps top to bottom, from 0.
    pub fn current_index(&self) -> Option<usize> {
        self.steps().iter().position(|s| s.id == self.current)
    }
}

fn collect_steps<'a>(items: &'a [QueueItem], out: &mut Vec<&'a QueueStep>) {
    for item in items {
        match item {
            QueueItem::Step(s) => out.push(s),
            block => {
                for part in block.parts() {
                    collect_steps(part, out);
                }
            }
        }
    }
}

/// What a Wait until, an If block or a Repeat until asks (`CONTEXT.md`: Condition): something
/// about the resident themself or one place of their own realm. Plain data, checked by the server.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Condition {
    /// They, or with `vehicle` the carriage or vessel they drive, carry at least or less than
    /// `amount` of `good`.
    Carries {
        #[serde(default, skip_serializing_if = "is_false")]
        #[ts(as = "Option<bool>", optional)]
        vehicle: bool,
        good: Good,
        compare: Compare,
        amount: f64,
    },
    /// They, or with `vehicle` the carriage or vessel they drive, are full or empty.
    Load {
        #[serde(default, skip_serializing_if = "is_false")]
        #[ts(as = "Option<bool>", optional)]
        vehicle: bool,
        load: LoadState,
    },
    /// A storage, workplace pile or site of the realm holds at least or less than `amount` of
    /// `good`. `place_id` is the building's id.
    Stock { place_id: String, good: Good, compare: Compare, amount: f64 },
    /// Their hunger meter or health is above or below `share` of full (0 to 1).
    Need { need: NeedName, side: Side, share: f64 },
    /// They are mounted (or, with `is` false, not).
    Mounted { is: bool },
    /// They are aboard a boat or ship (or, with `is` false, not).
    Aboard { is: bool },
    /// The game hour is before `hour`, or `hour` or later.
    Hour { side: HourSide, hour: f64 },
}

/// Every kind of condition (`Condition`'s `kind`), in the order the condition editor offers them
/// (`CONDITION_KINDS`).
pub const CONDITION_KINDS: [&str; 7] =
    ["carries", "load", "stock", "need", "mounted", "aboard", "hour"];

impl Condition {
    /// Its kind, as serde tags it (`CONDITION_KINDS`).
    pub const fn kind(&self) -> &'static str {
        match self {
            Condition::Carries { .. } => "carries",
            Condition::Load { .. } => "load",
            Condition::Stock { .. } => "stock",
            Condition::Need { .. } => "need",
            Condition::Mounted { .. } => "mounted",
            Condition::Aboard { .. } => "aboard",
            Condition::Hour { .. } => "hour",
        }
    }
}

/// At least or less than an amount (`Condition`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum Compare {
    AtLeast,
    LessThan,
}

/// Full or empty (`Condition::Load`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum LoadState {
    Full,
    Empty,
}

/// The resident's hunger meter or health (`Condition::Need`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum NeedName {
    Hunger,
    Health,
}

/// Above or below a share (`Condition::Need`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    Above,
    Below,
}

/// Before or after an hour (`Condition::Hour`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum HourSide {
    Before,
    After,
}

/// One step of a queue.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct QueueStep {
    /// From `nextStepId++`, or an id already in the queue (checked on editing).
    pub id: u32,
    pub order: OrderRequest,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub minutes: Option<f64>,
}

//! Resource nodes: their kinds, richness and stock, the veins that ran dry or come back, and the
//! patches of Forest and Hills tiles.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::named_enum::named_enum;

/// What a Forest or Hills tile that isn't full still holds for gathering (`CONTEXT.md`: Patch):
/// `left` units at tick `at`, growing back steadily from then on.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Patch {
    pub x: i32,
    pub y: i32,
    pub left: f64,
    pub at: u64,
}

named_enum! {
/// What a resource node yields once worked (`ResourceKind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub enum ResourceKind {
    Forest = "forest",
    Stone = "stone",
    IronOre = "ironOre",
    GoldOre = "goldOre",
    Coal = "coal",
}
}

/// How much a resource node gives per worker (`CONTEXT.md`: Richness), fixed when it comes into
/// being.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS,
)]
#[serde(rename_all = "camelCase")]
pub enum Richness {
    Poor,
    #[default]
    Normal,
    Rich,
}

impl Richness {
    /// What a worker's output on a node of this richness is multiplied by (`RICHNESS_FACTOR`).
    pub fn factor(self) -> f64 {
        let f = crate::balance::RICHNESS_FACTOR;
        match self {
            Richness::Poor => f.poor,
            Richness::Normal => f.normal,
            Richness::Rich => f.rich,
        }
    }

    /// Whether it is normal.
    pub fn is_normal(&self) -> bool {
        *self == Richness::Normal
    }

    /// Its steps up from poor: 0, 1 or 2.
    pub fn rank(self) -> u8 {
        self as u8
    }
}

/// A spot on the map where a workplace makes its good (`ResourceNode`); a normal or rich ore node
/// runs dry once worked long enough (`CONTEXT.md`: Running dry).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ResourceNode {
    pub id: String,
    pub kind: ResourceKind,
    pub x: f64,
    pub y: f64,
    /// Fixed when it comes into being (`CONTEXT.md`: Richness). Left out of a save while normal, so
    /// a normal node is saved as before richness (the frozen fixtures).
    #[serde(default, skip_serializing_if = "Richness::is_normal")]
    pub richness: Richness,
    /// What is left in a normal or rich ore node (`CONTEXT.md`: Running dry), given it when it
    /// comes into being (`fill_stock`). None for a node that never runs dry (poor, forest,
    /// stone) and for the nodes of worlds made without regions (tests, the frozen fixtures). Left
    /// out of a save while none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub stock: Option<VeinStock>,
}

impl ResourceNode {
    /// A normal node of `kind` at (x, y), with no stock.
    pub fn new(id: impl Into<String>, kind: ResourceKind, x: f64, y: f64) -> Self {
        ResourceNode { id: id.into(), kind, x, y, richness: Richness::Normal, stock: None }
    }

    /// Whether a node of its kind and richness runs dry (`CONTEXT.md`: Running dry): a normal or
    /// rich ore node (iron ore, gold ore, coal).
    pub fn runs_dry(&self) -> bool {
        matches!(self.kind, ResourceKind::IronOre | ResourceKind::GoldOre | ResourceKind::Coal)
            && self.richness != Richness::Poor
    }

    /// Gives it the stock of its kind and richness (`vein_stock`), or none if it never runs dry.
    pub fn fill_stock(&mut self) {
        self.stock = crate::balance::vein_stock(self.kind, self.richness)
            .filter(|_| self.runs_dry())
            .map(|first| VeinStock { first, left: first, made: 0.0 });
    }
}

/// A vein's stock (`CONTEXT.md`: Running dry): what it held when it came into being, what is left
/// and how much its workplaces have made from it, so that `left + made == first` always.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VeinStock {
    pub first: f64,
    pub left: f64,
    pub made: f64,
}

impl VeinStock {
    /// How the vein stands (`CONTEXT.md`: Running dry), from the share of `first` that is left.
    pub fn word(&self) -> VeinWord {
        VeinWord::of_share(if self.first > 0.0 { self.left / self.first } else { 0.0 })
    }
}

/// How a vein stands, as whoever works its node's workplace sees it (`CONTEXT.md`: Running dry):
/// in words, never as a number.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum VeinWord {
    Plenty,
    Thinning,
    NearlyGone,
    /// A node that never runs dry (poor, forest, stone).
    Endless,
}

impl VeinWord {
    /// The word for a vein with `share` of its first stock left (`VEIN_THINNING`,
    /// `VEIN_NEARLY_GONE`).
    pub fn of_share(share: f64) -> VeinWord {
        use crate::balance::{VEIN_NEARLY_GONE, VEIN_THINNING};
        if share <= VEIN_NEARLY_GONE {
            VeinWord::NearlyGone
        } else if share <= VEIN_THINNING {
            VeinWord::Thinning
        } else {
            VeinWord::Plenty
        }
    }

    /// Its name in scripts and on the wire.
    pub fn name(self) -> &'static str {
        match self {
            VeinWord::Plenty => "plenty",
            VeinWord::Thinning => "thinning",
            VeinWord::NearlyGone => "nearlyGone",
            VeinWord::Endless => "endless",
        }
    }
}

/// A node that ran dry (`CONTEXT.md`: Running dry): gone from the world, kept only so that a
/// Player who explored its tile keeps it on their map until they see the tile again, as a
/// building is (Last seen).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DryNode {
    pub id: String,
    pub kind: ResourceKind,
    pub x: f64,
    pub y: f64,
    #[serde(default, skip_serializing_if = "Richness::is_normal")]
    pub richness: Richness,
    /// The tick it ran dry.
    pub at: u64,
    /// The accounts (see `Realm::user_id`) that have seen its tile since, and so know it is gone.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub seen_gone_by: Vec<u64>,
    /// The id of the node of its kind and richness that came into being for it (`CONTEXT.md`:
    /// Running dry): in the world, waiting to come back, or by now dry itself. None only until
    /// the veins are placed in the tick it ran dry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub next: Option<String>,
}

/// A node that came into being where some Players had already explored (`CONTEXT.md`: Running
/// dry): those who have not seen its tile since still see no node there.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewVein {
    /// The node's id.
    pub id: String,
    pub x: f64,
    pub y: f64,
    /// The accounts (see `Realm::user_id`) that explored its tile before it was there and have
    /// not seen the tile since.
    pub unseen_by: Vec<u64>,
}

/// A node waiting to come back where it ran dry, as no fitting tile was found for it elsewhere
/// (`CONTEXT.md`: Running dry).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WaitingVein {
    /// The node as it comes back, with a full stock.
    pub node: ResourceNode,
    /// The tick it comes back.
    pub back_at: u64,
}

impl DryNode {
    /// The node as it was, as the map's terrain still lists it (`MapTerrain`).
    pub fn as_node(&self) -> ResourceNode {
        ResourceNode {
            id: self.id.clone(),
            kind: self.kind,
            x: self.x,
            y: self.y,
            richness: self.richness,
            stock: None,
        }
    }
}

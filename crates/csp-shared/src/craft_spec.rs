//! What the specs of the things that move off their building site hold: a vessel kind's and a
//! siege machine kind's. The specs themselves, one block per kind, are in
//! `balance/craft_specs.rs`.

use crate::world::{BuildingKind, SiegeMachineKind, VesselKind};

/// Everything fixed about a kind of vessel (`CONTEXT.md`: Vessel).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VesselSpec {
    /// What it is called in what the game says about it, and the start of its ids.
    pub name: &'static str,
    /// The kind of site it is built as.
    pub built_as: BuildingKind,
    /// Where it may be.
    pub waters: Waters,
    /// Most weight it carries, in kg: passengers at `PASSENGER_WEIGHT` and goods together. Its
    /// rower or crew don't count against it.
    pub capacity: f64,
    /// The fewest crew aboard for it to move; 0 for a vessel with no crew, which one resident rows.
    pub min_crew: f64,
    /// How fast it goes with an average rower or an unskilled crew, as a share of walking on
    /// Plains.
    pub speed: f64,
}

/// The water a kind of vessel may be on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Waters {
    LakeAndSea,
    SeaOnly,
}

/// Everything fixed about a kind of siege machine (`CONTEXT.md`: Siege machine).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SiegeMachineSpec {
    /// What it is called in what the game says about it, and the start of its ids.
    pub name: &'static str,
    /// The kind of site it is built as.
    pub built_as: BuildingKind,
    /// The fewest crew on its tile for it to be pushed or used.
    pub crew: f64,
    /// Damage it takes from blows before it breaks.
    pub strength: f64,
    /// How far from it, in tiles, the wall, gate or tower it attacks may be.
    pub reach: f64,
    /// Ticks between its attacks.
    pub attack_ticks: f64,
    /// Damage each attack does.
    pub blow: f64,
}

impl VesselKind {
    /// The vessel a finished site of `kind` becomes, if it is a vessel's.
    pub fn built_as(kind: BuildingKind) -> Option<VesselKind> {
        Self::ALL.iter().copied().find(|v| v.spec().built_as == kind)
    }
}

impl SiegeMachineKind {
    /// The machine a finished site of `kind` becomes, if it is a siege machine's.
    pub fn built_as(kind: BuildingKind) -> Option<SiegeMachineKind> {
        Self::ALL.iter().copied().find(|m| m.spec().built_as == kind)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_crafts_name_is_the_one_serde_writes() {
        for v in VesselKind::ALL {
            assert_eq!(serde_json::to_value(v).unwrap(), v.spec().name);
        }
        for m in SiegeMachineKind::ALL {
            assert_eq!(serde_json::to_value(m).unwrap(), m.spec().name);
        }
    }

    #[test]
    fn each_craft_is_built_as_a_site_of_its_own() {
        for &v in VesselKind::ALL {
            assert_eq!(VesselKind::built_as(v.spec().built_as), Some(v));
            assert_eq!(SiegeMachineKind::built_as(v.spec().built_as), None);
        }
        for &m in SiegeMachineKind::ALL {
            assert_eq!(SiegeMachineKind::built_as(m.spec().built_as), Some(m));
        }
        assert_eq!(VesselKind::built_as(BuildingKind::Carriage), None);
        assert_eq!(SiegeMachineKind::built_as(BuildingKind::Carriage), None);
    }
}

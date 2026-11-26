//! Vessels and siege machines: every fact and number of each kind, one block per kind
//! (`VesselSpec`, `SiegeMachineSpec`: what each number means). A new kind is its name in the enum
//! and its block here. The client's numbers (`BOAT_CAPACITY`, `RAM_CREW`, ...) are read from these
//! blocks, in `vessels.rs` and `fighting.rs`; what building one takes is in its site's block
//! (`building_specs.rs`).

use crate::craft_spec::{SiegeMachineSpec, VesselSpec, Waters};
use crate::world::{BuildingKind, SiegeMachineKind, VesselKind};

impl VesselKind {
    /// The kind's facts and numbers. Exhaustive: a kind without a block does not compile.
    pub const fn spec(self) -> &'static VesselSpec {
        match self {
            VesselKind::Boat => &BOAT,
            VesselKind::Ship => &SHIP,
        }
    }
}

impl SiegeMachineKind {
    /// The kind's facts and numbers. Exhaustive: a kind without a block does not compile.
    pub const fn spec(self) -> &'static SiegeMachineSpec {
        match self {
            SiegeMachineKind::Ram => &RAM,
            SiegeMachineKind::Catapult => &CATAPULT,
            SiegeMachineKind::Ballista => &BALLISTA,
        }
    }
}

pub(super) const BOAT: VesselSpec = VesselSpec {
    name: "boat",
    built_as: BuildingKind::Boat,
    waters: Waters::LakeAndSea,
    // Three residents and a little cargo, or a single rower's worth of goods eight times over.
    capacity: 250.0,
    min_crew: 0.0,
    // A little quicker than walking round the shore, so crossing pays off.
    speed: 1.2,
};

pub(super) const SHIP: VesselSpec = VesselSpec {
    name: "ship",
    built_as: BuildingKind::Ship,
    waters: Waters::SeaOnly,
    // Far more than a carriage: five carriages' worth.
    capacity: 2000.0,
    // A captain and three hands to work the sails, so a small realm can man one but it takes a few
    // of its residents.
    min_crew: 4.0,
    // Faster than a boat is rowed, as wind does the work; the crew's Seafaring adds to it as it
    // does to rowing (`SEAFARING_SKILL_EFFECT`, from their average).
    speed: 1.6,
};

pub(super) const RAM: SiegeMachineSpec = SiegeMachineSpec {
    name: "ram",
    built_as: BuildingKind::Ram,
    // A few residents, as many as a ship's, so a ram takes a realm's hands from other work.
    crew: 4.0,
    // Twice a tile of wooden wall, so defenders who come out need a while at it, but less than a
    // stone wall tile.
    strength: 6000.0,
    // What it stands next to.
    reach: 1.0,
    // A heavy beam swung back and forth by its crew, slower than a resident's blows.
    attack_ticks: 10.0,
    // Many times harder than a blow: it breaks a tile of wooden wall in 20 strikes, a little over
    // three minutes, and one of stone in about thirteen, where a Spear alone takes 12 and 50.
    blow: 150.0,
};

pub(super) const CATAPULT: SiegeMachineSpec = SiegeMachineSpec {
    name: "catapult",
    built_as: BuildingKind::Catapult,
    // One fewer than a ram's, a lighter frame to push and an arm to wind and load.
    crew: 3.0,
    // A tile of wooden wall's, half a ram's, having no roof of planks over it.
    strength: 3000.0,
    // Beyond a bow's from a wall: a Bow reaches 8, 12 from up on a wall, so a catapult shoots from
    // well out of any archer's reach.
    reach: 20.0,
    // Its arm wound down and a Stone loaded each time, six times a ram's strikes, so it does less
    // to a wall a minute than a ram at it.
    attack_ticks: 60.0,
    // A tile of wooden wall falls to 5 in five minutes, one of stone to 20 in twenty, slower than
    // a ram at the wall but from out of reach.
    blow: 600.0,
};

pub(super) const BALLISTA: SiegeMachineSpec = SiegeMachineSpec {
    name: "ballista",
    built_as: BuildingKind::Ballista,
    crew: 2.0,
    strength: 2000.0,
    reach: 12.0,
    attack_ticks: 30.0,
    blow: 200.0,
};

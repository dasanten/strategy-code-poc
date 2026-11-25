//! How NPC cities plan: jobs, walls, roads, scouts, traders, founding and their stance.

use serde::Serialize;

use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NpcJobScore {
    /// Farming for a worker off the farms, while Food runs short: past the farmers it keeps.
    pub farm_food_short: f64,
    /// Farming, while it lacks the farmers it keeps.
    pub farm: f64,
    /// Not weighed: where revivers get their turn, Food for those who aren't Down coming first.
    pub revive: f64,
    /// Building its project.
    pub project: f64,
    /// Making a good short of its reserve, at the least.
    pub short: f64,
    pub short_range: f64,
    /// Its road crew.
    pub road: f64,
    /// Scouting.
    pub scout: f64,
    /// Going back to the workplace they were let go from.
    pub back: f64,
    /// Working for surplus, at the least.
    pub surplus: f64,
    pub surplus_range: f64,
}

/// What weighs on a job at a place besides what it is for (`CONTEXT.md`: Stance; ADR 0039): each
/// takes from the job's score, together at most `most`, so a dangerous far workplace can lose to a
/// safe near one. All zero ([`NpcJobWeights::NEUTRAL`]) chooses as the fixed bands did.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NpcJobWeights {
    /// Per tile from the city's storage to the workplace.
    pub distance: f64,
    /// Per unit of the danger places the city remembers by the way there (about one per person
    /// lost, fading).
    pub danger: f64,
    /// Per worker of the city already there.
    pub crew: f64,
    /// The most all of them take from one job.
    pub most: f64,
}

impl NpcJobWeights {
    /// Nothing weighs but what the job is for.
    pub const NEUTRAL: NpcJobWeights =
        NpcJobWeights { distance: 0.0, danger: 0.0, crew: 0.0, most: 0.0 };
}

/// The shape of `NPC_STANCE`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NpcStance {
    /// The threat from the one Organization it fears most at which Fortify's need reaches one.
    pub fortify_threat: f64,
    /// Fortify keeps this many times the soldiers it keeps by its size.
    pub fortify_soldiers: f64,
    /// Fortify sends this many soldiers more with each escort.
    pub fortify_escorts: f64,
    /// Fortify shuts its gates to an armed outsider this many times as far off.
    pub fortify_gate_watch: f64,
    /// Fortify weighs the danger places by the way to a workplace this many times as much.
    pub fortify_danger: f64,
    /// Trade's need with a Trade Org warehouse in its traders' reach and a Food surplus.
    pub trade_need: f64,
    /// Under Trade a city's surplus caps are this share of their size, so more goes to market.
    pub trade_surplus_cap: f64,
    /// Trade has this many traders more out.
    pub trade_traders: f64,
    /// Expand's need with a Food surplus and no good short.
    pub expand_need: f64,
    /// Under Expand a city waits this share of the days full before it founds.
    pub expand_full_days: f64,
    /// Expand sends this many times the scouts.
    pub expand_scouts: f64,
    /// The temperament's own stance (merchant Trade, militarist Fortify, settler Expand) weighs
    /// this many times its need.
    pub temperament_tilt: f64,
}

/// The shape of `NPC_ACTING_FIRST`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NpcActingFirst {
    /// The threat from one Organization at which a city seeks allies against it.
    pub ally_threat: f64,
    /// The threat from one Organization at which a city hires mercenaries.
    pub hire_threat: f64,
    /// How many Trade Org soldiers it hires at most.
    pub hire_soldiers: f64,
    /// For how many game days.
    pub hire_days: f64,
}

/// The shape of `NPC_RETALIATE`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NpcRetaliate {
    /// The threat from one realm at which a city turns on it.
    pub threat: f64,
    /// It ends once its threat from them has faded below this.
    pub ends_below: f64,
    /// The threat at which it marches on one of their cities.
    pub march_threat: f64,
    /// It marches only with its standing toward them at this or below.
    pub march_standing: f64,
    /// And only with an army this many times as strong as that city's defenders.
    pub march_outweigh: f64,
}

balance! {
/// Ticks between a game-run city's planning passes (`CONTEXT.md`: NPC city; ADR 0016): a game
/// hour, so a city reacts to a change within a real minute. Cities are staggered by their id, so
/// about one plans per tick.
pub const NPC_PLAN_TICKS: f64 = 60.0;

/// What each job of an NPC city is worth to a free adult (`CONTEXT.md`: NPC city; ADR 0029): each
/// goes to the highest-scoring job with room. Only the order and the gaps mean anything: `short` runs
/// up to `short` + `shortRange` by how much of a good it lacks, staying below `project`, and `surplus`
/// up to `surplus` + `surplusRange` by how far below its cap, staying below `back`.
pub const NPC_JOB_SCORE: NpcJobScore = NpcJobScore {
    farm_food_short: 110.0,
    farm: 100.0,
    revive: 80.0,
    project: 55.0,
    short: 50.0,
    short_range: 4.0,
    road: 30.0,
    scout: 28.0,
    back: 20.0,
    surplus: 10.0,
    surplus_range: 5.0,
};

/// How much more another job must score for an NPC city's worker to leave theirs (`CONTEXT.md`: NPC
/// city; ADR 0029), so nobody goes back and forth: more than the whole of `NPC_JOB_SCORE.shortRange`
/// and the step up to `project`, so a worker on one short good stays for another or for the project,
/// and less than the gaps above `back`, so one let go leaves for anything that wants them.
pub const NPC_JOB_MARGIN: f64 = 6.0;

/// What weighs on an NPC city's jobs at a place (`NpcJobWeights`). One person lost by the way
/// costs more than `NPC_JOB_MARGIN`, so workers move to a safer workplace of the same good. Distance
/// and crew weigh nothing yet: weighed on their own they pull spare hands from far surplus work
/// (a new mine past a dry one) and shake the farmers of a big city (the slow NPC tests); a stance
/// tilts them (T98.4). At most `most`, under the gap from `NPC_JOB_SCORE.short` to `road`, so work
/// on a good that is short stays ahead of the road crew however dangerous.
pub const NPC_JOB_WEIGHTS: NpcJobWeights =
    NpcJobWeights { distance: 0.0, danger: 7.0, crew: 0.0, most: 15.0 };

/// Residents to each step of an NPC city's needs and crews (`CONTEXT.md`: NPC reserve, Spare hands'
/// work, NPC road): its Wood and Stone kept, surplus caps, builders and road crew are this many steps
/// of a village's (`npcNeedsScale`), in whole steps so one birth doesn't move them. Below two steps
/// it keeps a village's numbers, and from two on it is a big city (`isBigNpcCity`): at 50 residents,
/// about three times a town.
pub const NPC_RESIDENTS_PER_NEEDS_STEP: f64 = 25.0;

/// Most of an NPC city's adults that build at once, per step of its needs (`npcNeedsScale`;
/// `CONTEXT.md`: NPC city): laying out, carrying materials to the site, building or tearing down. The
/// others keep working.
pub const NPC_BUILDERS: f64 = 2.0;

/// Most of an NPC city's spare hands on its road crew at once, per step of its needs
/// (`npcNeedsScale`; `CONTEXT.md`: NPC road), apart from its builders: enough for a road to grow out
/// day by day and to fetch for each other, while the rest go on working for surplus.
pub const NPC_ROAD_CREW: f64 = 2.0;

/// The longest way an NPC city's road crew takes on (`CONTEXT.md`: NPC road), in tiles: a way longer
/// than this is given up. Past `NPC_FOUND_REACH`, so a city can join its daughter round a lake.
pub const NPC_ROAD_LONGEST: f64 = 1200.0;

/// How far outside its area an NPC city still fetches a Down resident of its own (`CONTEXT.md`:
/// Reviving), in tiles: about a quarter of a game day's walk on plains each way.
pub const NPC_REVIVE_REACH: f64 = 48.0;

/// How far past its reserve an NPC city's spare hands work for surplus, by good, in units per step
/// of its needs (`npcNeedsScale`; `CONTEXT.md`: Spare hands' work). Several of a trader's full loads
/// (about 30 kg, `CARRY_BASE`), so its trader has something to sell, and above the materials a Full city wants (`townHall` and
/// `storage` in `BUILD_MATERIALS`), or it could never found; few weapons, which its trader never
/// sells. Tools (`CONTEXT.md`: Tools) are forged only this way: below its reserve of them they are
/// the first surplus work, and past it a couple spare. A good not named here is not worked for
/// surplus.
pub const NPC_SURPLUS_CAP: Table<f64> = Table(&[
    ("food", 100.0),
    ("wood", 150.0),
    ("stone", 100.0),
    ("ironOre", 60.0),
    ("iron", 60.0),
    ("goldOre", 60.0),
    ("coins", 300.0),
    ("spear", 4.0),
    ("tools", 2.0),
]);

/// How many times its surplus cap (`NPC_SURPLUS_CAP`) an NPC city's spare hands work on to, once
/// every good they could work for is at its cap and nothing else wants them (`CONTEXT.md`: Spare
/// hands' work): the good least far past its cap first, farms aside. Enough that a big city with no
/// one to sell to and no room to found keeps its crews at work for a game month or more while wear
/// and decay use its goods up, and bounded, so its storage never fills without end.
pub const NPC_SURPLUS_PAST_CAP: f64 = 4.0;

/// How many tiles further out an NPC city puts up its new wall when it has no room left inside
/// the old one (`CONTEXT.md`: NPC city), on every side, with the gate in the same place. At most
/// `CITY_BUILDING_REACH`, so the new wall stays part of the city once the old one is gone.
pub const NPC_WALL_STEP: f64 = 8.0;

/// How far from the middle of its town hall a big NPC city's inner ring of wall may stand
/// (`CONTEXT.md`: Bigger projects), in tiles: room for its first lanes round the hall and storage,
/// and always short of its outer wall, which stands at least 14 from its home.
pub const NPC_INNER_WALL_REACH: f64 = 9.0;

/// Tiles along each side of a block of the Grid layout (`CONTEXT.md`: City layout): room for two
/// houses each way, or one stable. A lane one tile wide, left free for a street, runs between blocks.
pub const CITY_GRID_BLOCK: f64 = 4.0;

/// Tiles from one circular lane of the Rings layout to the next (`CONTEXT.md`: City layout), the first
/// this far from the middle of the town hall: room between two lanes for a circle of houses, or
/// stables, all the way round.
pub const CITY_RING_STEP: f64 = 5.0;

/// Tiles along the street between two side lanes of the Main street layout (`CONTEXT.md`: City
/// layout): a row of four houses, long enough to read as a row and not as a block of the Grid. A lane
/// one tile wide, left free for a street, comes after them.
pub const CITY_SIDE_LANE_GAP: f64 = 8.0;

/// Tiles deep of a band of rows in the Quarters layout (`CONTEXT.md`: City layout): two rows of houses
/// back to back, or one row of stables. A lane one tile wide, left free for a street, runs between
/// bands.
pub const CITY_QUARTER_ROWS: f64 = 4.0;

/// How many tiles of wall an NPC city's builder fetches the materials for in one trip to the
/// storage (`CONTEXT.md`: NPC city, Fetching materials): a 40 m stretch's worth, so a long wall is
/// not one walk per tile. What a tile doesn't take goes to the next.
pub const NPC_WALL_TILES_PER_TRIP: f64 = 4.0;

/// Residents an NPC city has from which it is a town and upgrades its wall to stone (`CONTEXT.md`:
/// Wall / Gate, Wood or stone): as many as a town has when the world is made, so a village goes
/// stone once it has grown into one.
pub const NPC_STONE_WALL_RESIDENTS: f64 = NPC_TOWN.residents;

/// Tiles of stone wall whose Stone an NPC town sets aside in its reserve while it builds or
/// upgrades its wall in stone (`CONTEXT.md`: NPC reserve, Wood or stone): two builders' trips
/// (`NPC_WALL_TILES_PER_TRIP`), 32 Stone, so its roads, repairs and trade leave the wall a trip
/// in hand while the next one is quarried (Epic 113: with faster growth they took it all).
pub const NPC_WALL_STONE_SET_ASIDE_TILES: f64 = 2.0 * NPC_WALL_TILES_PER_TRIP;

/// How far from its home an NPC city looks for a resource node to build a workplace on when it
/// needs a material it has no workplace for (`CONTEXT.md`: NPC city), in tiles: about twenty
/// minutes' walk on plains.
pub const NPC_NODE_REACH: f64 = 160.0;

/// How many of an NPC city's residents it takes to send one scout at a time, rounded up
/// (`CONTEXT.md`: Scout): a village one, a town of 16 two, a city of 48 four.
pub const NPC_RESIDENTS_PER_SCOUT: f64 = 12.0;

/// How far from its home an NPC city comes to know resource nodes through its scouts (`CONTEXT.md`:
/// Scout), in tiles: 2.5 times its set reach (`NPC_NODE_REACH`), about 50 minutes' walk on plains.
pub const NPC_SCOUT_LIMIT: f64 = 400.0;

/// The squares of map an NPC city's knowledge from its scouts goes by (`CONTEXT.md`: Scout), in tiles
/// along each side. Small enough that a scout standing in one has its middle and its neighbours' in
/// sight (`SIGHT_RANGE`), large enough that what a city knows stays a few hundred numbers.
pub const NPC_SCOUT_SECTOR: f64 = 32.0;

/// How far from its home a Trade Org warehouse may be for an NPC city to send its trader there
/// (`CONTEXT.md`: NPC trader), in tiles: about a game day and a half's walk on plains each way.
pub const NPC_TRADER_REACH: f64 = 720.0;

/// Residents of an NPC city for each trader it has out at once (`CONTEXT.md`: NPC trader), rounded
/// down: a village, a town and a city of under 60 keep one; a city of 110 sends three. Each walks
/// every tick, so this is what its trading costs the server.
pub const NPC_RESIDENTS_PER_TRADER: f64 = 30.0;

/// How far from its home a Player's offer may be for an NPC city to send its trader there
/// (`CONTEXT.md`: NPC cities at an offer), in tiles: as far as it goes to a Trade Org warehouse
/// (`NPC_TRADER_REACH`), since it is the same trader on the same Food.
pub const NPC_OFFER_REACH: f64 = 720.0;

/// Game days after it left that an NPC city stops waiting for its trader (`CONTEXT.md`: NPC
/// trader): dead, robbed or stuck, they are dropped from its plan and it may send another.
/// Several times the longest trade run (`NPC_TRADER_REACH` there and back).
pub const NPC_TRADER_GIVE_UP_DAYS: f64 = 10.0;

/// How far beyond its wall an NPC city looks for Plains to lay out a new farm on, in tiles. Farms
/// go beyond where its next wall would stand.
pub const NPC_FARM_REACH: f64 = 48.0;

/// Game days an NPC city of up to `NPC_FOUND_VILLAGE_RESIDENTS` must have been full before it founds
/// a daughter (`CONTEXT.md`: Full city): a game week of idle spare hands and nothing short. A bigger
/// city waits less (`npcFullDays`).
pub const NPC_FULL_DAYS: f64 = 7.0;

/// Residents up to which an NPC city founds as a village does (`CONTEXT.md`: Full city, Founding): it
/// waits `NPC_FULL_DAYS` and sends a village's worth. About twice a town as it is placed.
pub const NPC_FOUND_VILLAGE_RESIDENTS: f64 = 30.0;

/// Residents past `NPC_FOUND_VILLAGE_RESIDENTS` that take a game day off how long a full city waits
/// (`npcFullDays`): a city of 110 waits 3 game days.
pub const NPC_FULL_RESIDENTS_PER_DAY: f64 = 20.0;

/// The fewest game days any full NPC city waits before it founds (`npcFullDays`).
pub const NPC_FULL_DAYS_LEAST: f64 = 2.0;

/// Game days a dip below its reserve may last before a full NPC city's wait starts over (`CONTEXT.md`:
/// Full city): Food its scouts and road crew take out and bring back doesn't count.
pub const NPC_FULL_DIP_DAYS: f64 = 1.0;

/// How much of its Food surplus cap (`NPC_SURPLUS_CAP`) past its reserve an NPC city holds before
/// its founding party's materials count as short (`CONTEXT.md`: Full city): Food, its surplus
/// too, comes first (Daniel, 2026-11-15). Half, so a birth or a party's Food doesn't take it below
/// its reserve, and spoilage still lets it get there.
pub const NPC_FOUND_FOOD_SURPLUS_SHARE: f64 = 0.5;

/// Residents past `NPC_FOUND_VILLAGE_RESIDENTS` that add one adult to a founding party
/// (`npcFoundingPartySize`): a city of 110 sends the most, about one in eight of it.
pub const NPC_FOUND_RESIDENTS_PER_MEMBER: f64 = 10.0;

/// The largest founding party (`npcFoundingPartySize`): with the houses it carries for those past a
/// village's worth (`foundingMaterials`), its materials stay under the surplus caps
/// (`NPC_SURPLUS_CAP`), or a big city could never found on what it makes.
pub const NPC_FOUND_PARTY_MOST: f64 = 14.0;

/// Residents from which an NPC city counts as a town and sends soldiers along with its traders
/// (`CONTEXT.md`: Escort); a village's trader goes alone. Between a village's start (`NPC_VILLAGE`)
/// and a town's (`NPC_TOWN`).
pub const NPC_ESCORT_TOWN_RESIDENTS: f64 = 12.0;

/// Soldiers a town's trader takes along on a run (`CONTEXT.md`: Escort), on a way not known to be
/// dangerous.
pub const NPC_TRADER_ESCORTS: f64 = 1.0;

/// Soldiers a founding party takes per member (`CONTEXT.md`: Escort), rounded down and at least
/// one, in place of its one armed member: a village's worth (6) takes one, the largest party two.
pub const NPC_FOUND_ESCORT_SHARE: f64 = 0.2;

/// Random tiles a full NPC city tries in one search for its daughter's site (`CONTEXT.md`:
/// Founding), once a game day: enough to find free Plains on most maps, cheap enough to do while
/// it waits.
pub const NPC_FOUND_SAMPLES: f64 = 200.0;

/// How far from its home a full NPC city looks for its daughter's site, in tiles (`CONTEXT.md`:
/// Founding): twice the usual distance between cities, about five game days' walk on Plains.
pub const NPC_FOUND_REACH: f64 = 960.0;

/// Game days of Food a founding party's member carries for their first weeks at the site
/// (`CONTEXT.md`: Founding), besides the Food for twice the walk there.
pub const NPC_FOUND_FOOD_DAYS: f64 = 20.0;

/// Game days after setting out that a founding party whose town hall doesn't stand gives up and
/// walks home (`CONTEXT.md`: Founding); the mother may try again once it is full again.
pub const NPC_FOUND_GIVE_UP_DAYS: f64 = 20.0;

/// The standing a daughter and its mother start at toward each other (`CONTEXT.md`: Founding):
/// high, of `STANDING_RANGE`, fading like any standing.
pub const NPC_FOUND_STANDING: f64 = 80.0;

/// The chance a daughter takes its mother's temperament (`CONTEXT.md`: Temperament); otherwise it
/// is drawn from its id like any NPC city's, so it may still come out the same.
pub const NPC_DAUGHTER_TAKES_MOTHERS_TEMPERAMENT: f64 = 0.75;

/// What an NPC city's stance does and when it takes one (`CONTEXT.md`: Stance; T98.4).
pub const NPC_STANCE: NpcStance = NpcStance {
    fortify_threat: 35.0,
    fortify_soldiers: 1.5,
    fortify_escorts: 1.0,
    fortify_gate_watch: 1.5,
    fortify_danger: 2.0,
    trade_need: 0.8,
    trade_surplus_cap: 0.5,
    trade_traders: 1.0,
    expand_need: 0.8,
    expand_full_days: 0.5,
    expand_scouts: 2.0,
    temperament_tilt: 1.5,
};

/// When an NPC city acts first against a threat (`CONTEXT.md`: Acting first; T98.5).
pub const NPC_ACTING_FIRST: NpcActingFirst =
    NpcActingFirst { ally_threat: 30.0, hire_threat: 30.0, hire_soldiers: 4.0, hire_days: 7.0 };

/// When an NPC city retaliates and marches (`CONTEXT.md`: Retaliating; T98.8).
pub const NPC_RETALIATE: NpcRetaliate = NpcRetaliate {
    threat: 60.0,
    ends_below: 15.0,
    march_threat: 120.0,
    march_standing: -60.0,
    march_outweigh: 3.0,
};
}

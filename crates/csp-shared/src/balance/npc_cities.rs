//! NPC cities: their size, price, food, soldiers, demands and couples.

use serde::Serialize;

use super::*;

/// What an NPC city is placed with, by its size: a walled square like a starting city's.
use crate::time::TICKS_PER_GAME_DAY;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NpcCitySize {
    /// Tiles along each side, wall included: an odd number, so its storage has a middle tile.
    pub size: f64,
    /// Adult residents, with random stats like a starting city's.
    pub residents: f64,
    /// Houses inside the wall, in a row north of the storage; room for everyone and a little more.
    pub houses: f64,
    /// Farms outside the wall, by the gate; the residents start on them, working them.
    pub farms: f64,
    /// Food in its storage, in units.
    pub food: f64,
}

balance! {
/// NPC towns placed in each frontier region when the world is generated (`CONTEXT.md`: NPC city,
/// Frontier). Towns are placed first; fewer when a region has no room left. No town stands in a
/// heartland, and no NPC city on an island.
pub const NPC_TOWNS_PER_FRONTIER: f64 = 1.0;

/// NPC villages placed in each frontier region, after the towns, like `NPC_TOWNS_PER_FRONTIER`.
pub const NPC_VILLAGES_PER_FRONTIER: f64 = 1.0;

/// NPC villages placed in each heartland (`CONTEXT.md`: Heartland), after its trading post.
pub const NPC_VILLAGES_PER_HEARTLAND: f64 = 1.0;

/// How far an NPC city, trading post or the Trade Org HQ stands from every starting site
/// (`CONTEXT.md`: Starting site), in tiles from middle to middle: room for a starting city, its
/// farm and its stable between them (about 12 minutes' walk on plains). A full NPC city founds no
/// daughter closer either.
pub const NPC_STARTING_SITE_CLEARANCE: f64 = 96.0;

/// How far an NPC city, trading post or the Trade Org HQ, with the ring its farms go in, stands
/// from every pass and land bridge (`CONTEXT.md`: Region), in tiles: none blocks the way.
pub const NPC_WAY_CLEARANCE: i32 = 24;

/// NPC cities lie at least this many tiles from every other city, starting cities and NPC cities
/// alike (about an hour's walk on plains), the short way round the map. A daughter keeps it scaled
/// with the side on a map of half to all of `MAP_SIZE`'s side (`daughter_min_distance`, T100.8).
pub const NPC_CITY_MIN_DISTANCE: f64 = 480.0;

/// A village: a starting city's square, a few fewer residents, one farm.
pub const NPC_VILLAGE: NpcCitySize =
    NpcCitySize { size: 29.0, residents: 6.0, houses: 2.0, farms: 1.0, food: 75.0 };

/// A town: a wider square, twice the residents of a starting city, two farms.
pub const NPC_TOWN: NpcCitySize =
    NpcCitySize { size: 45.0, residents: 16.0, houses: 5.0, farms: 2.0, food: 200.0 };

/// Game days a realm must occupy a city's town hall without a break to capture the city
/// (`CONTEXT.md`: Capturing a city, Occupying a town hall; ADR 0017): long enough for its owner to
/// hear of it and march back.
pub const OCCUPATION_GAME_DAYS: f64 = 10.0;

/// What an NPC city asks for each resident living there when it is bought (`CONTEXT.md`: Buying a
/// city), in Coins: twenty game days of one mint worker's coins (`RECIPES`, `BATCHES_PER_DAY`), or
/// five of a full gold mine and its mint.
pub const CITY_PRICE_PER_RESIDENT: f64 = 400.0;

/// What an NPC city asks for each of its finished buildings when it is bought, in Coins, by kind;
/// a kind missing here adds nothing. A village (6 residents, a town hall, a storage, 2 houses, a
/// farm and its wall ring) comes to about 2 800 coins, which three residents can carry; a town to
/// about 7 000. A stretch of wall is a quarter of what it was on the old 40 m tiles.
pub const CITY_PRICE_BY_BUILDING: Table<f64> = Table(&[
    ("townHall", 200.0),
    ("house", 50.0),
    ("storage", 50.0),
    ("farm", 30.0),
    ("stable", 40.0),
    ("wall", 0.5),
    ("gate", 1.25),
]);

/// An NPC city's Food runs short (`CONTEXT.md`: NPC city) when its storages hold less than its
/// residents eat in this many game days. It then puts residents on its farms first.
pub const NPC_FOOD_SHORT_DAYS: f64 = 5.0;

/// Game days in which the farmers an NPC city keeps win back what its Food lacks of its reserve
/// (`CONTEXT.md`: NPC city, #1379): below its reserve it keeps a farmer more for every
/// `WORK_OUTPUT_PER_DAY` food times this many it lacks, besides those who feed everyone.
pub const NPC_FOOD_REFILL_DAYS: f64 = 10.0;

/// Units of Food a farm's pile keeps when a worker carries its output away (`CONTEXT.md`:
/// Carrying the output), so the workers there can still refill at their workplace (Refilling at a
/// workplace). Written into the Work default's source, where a Player can change it.
pub const WORK_FOOD_KEPT: f64 = 2.0;

/// Share of an NPC city's adults it keeps as soldiers (`CONTEXT.md`: NPC city, Soldier), rounded
/// up so even a village keeps one: a starting village (6 residents) keeps 2, a town (16) keeps 4.
pub const NPC_SOLDIER_SHARE: f64 = 0.25;

/// What each soldier of an NPC city that knows of a coal node wants (`CONTEXT.md`: NPC reserve),
/// forged in this order: its smithy forges the first its soldiers still lack. A city with no coal
/// node in reach keeps to the iron spear (`NPC_SMITHY_WEAPON`).
pub const NPC_STEEL_KIT: [&str; 3] = ["steelSword", "steelArmour", "steelShield"];

/// Share of an NPC city's soldiers it arms with a Bow once it has a smithy (`CONTEXT.md`: Ranged
/// combat, NPC reserve), rounded down: a town's 4 soldiers have 2 archers, a village's 2 one.
pub const NPC_ARCHER_SHARE: f64 = 0.5;

/// The Arrows an NPC city's archer carries, fetched from its storage as they run low; its reserve
/// keeps as many again in its storages for each archer it wants (`CONTEXT.md`: NPC reserve).
pub const NPC_ARCHER_ARROWS: f64 = 20.0;

/// How many of an NPC city's soldiers stand on its town hall between fights, the first to be posted
/// (`CONTEXT.md`: Soldier posts). One there is enough to block an occupation; a second keeps it held
/// when the first is called away.
pub const NPC_SOLDIERS_ON_HALL: f64 = 2.0;

/// How many of an NPC city's soldiers stand at each of its gates, once its hall is held.
pub const NPC_SOLDIERS_AT_GATE: f64 = 1.0;

/// How many tiles out from its town hall an NPC city's soldiers stand around it when its wall has too
/// few tiles for them, or it has none (`CONTEXT.md`: Soldier posts).
pub const NPC_POST_AROUND_HALL: f64 = 2.0;

/// Ticks each lot of a big NPC city's soldiers trains before the next lot's turn (`CONTEXT.md`: Who
/// trains): five game days, long enough to be worth the walk there and back.
pub const NPC_TRAIN_TURN_TICKS: f64 = 5.0 * TICKS_PER_GAME_DAY;

/// The most of an NPC city's soldiers walking a round at once, whatever its size (`CONTEXT.md`: Soldier
/// posts). They walk every tick, the dearest of a soldier's jobs, so a city's cost stops growing here;
/// eight keep a big city's soldiers busy in peace (`CONTEXT.md`: Soldiers in peace), those just
/// standing on a post about a tenth of its adults.
pub const NPC_PATROLS_MAX: f64 = 8.0;

/// One soldier walks a round for every this many on an NPC city's wall, up to `NPC_PATROLS_MAX`:
/// two in three of them, so in peace few just stand on a post (`CONTEXT.md`: Soldiers in peace).
pub const NPC_SOLDIERS_PER_PATROL: f64 = 1.5;

/// How far from its home an NPC city sends soldiers after a thief it knows of (`CONTEXT.md`:
/// Acting first), in tiles: its set reach (`NPC_NODE_REACH`). A thief further off is let go.
pub const NPC_HUNT_REACH: f64 = 160.0;

/// How many soldiers an NPC city sends after each thief, as far as it has soldiers beyond its hall
/// and gate posts (`CONTEXT.md`: Acting first).
pub const NPC_HUNTERS_PER_THIEF: f64 = 2.0;

/// How many times an Organization's strength (all its armed residents, as respect weighs them) an
/// NPC city's own side must be before it sends that Organization a demand (`CONTEXT.md`: NPC
/// demand): "far outweighs", as a realm must far outweigh a city for it to yield to one
/// (`DEMAND_YIELD_RESPECT_TIMES`).
pub const NPC_DEMAND_OUTWEIGH_TIMES: f64 = 4.0;

/// The least strength an NPC city's own side must have to send a demand (`CONTEXT.md`: NPC
/// demand): as much as a city must see to yield to one (`DEMAND_YIELD_RESPECT_MIN`), so a village
/// without soldiers asks nobody for anything.
pub const NPC_DEMAND_MIN_STRENGTH: f64 = 25.0;

/// The Coins an NPC city demands (`CONTEXT.md`: NPC demand): about what a few days of a small
/// realm's trade bring in, enough to sting, not to ruin.
pub const NPC_DEMAND_COINS: f64 = 50.0;

/// An NPC city's demand's deadline, in game days (`CONTEXT.md`: NPC demand): one real day, as the
/// Trade Organization gives for a debt (`TRADE_ORG_DEBT_DEMAND_DAYS`), so a Player who comes by
/// once a day can still pay.
pub const NPC_DEMAND_DAYS: f64 = 60.0;

/// Game days before an NPC city sends the same Organization its next demand, from the last
/// (`CONTEXT.md`: NPC demand): two real days, so one is answered or lapsed a real day before the
/// next comes.
pub const NPC_DEMAND_AGAIN_DAYS: f64 = 120.0;

/// Where an NPC city's standing toward an Organization falls to, at most, when it refuses or lets
/// lapse that city's demand (`CONTEXT.md`: NPC demand): hostile, below where it refuses them
/// (`NPC_CITY_REFUSES_STANDING`).
pub const NPC_DEMAND_REFUSED_STANDING: f64 = -40.0;

/// How long a new realm is sheltered from NPC cities, in game days (`CONTEXT.md`: New realm's
/// shelter): two game weeks, nearly six real hours, to build a first army.
pub const NEW_REALM_SHELTER_DAYS: f64 = 14.0;

/// Tiles from a workplace within which an Organization's residents hold it (`CONTEXT.md`: Taking a
/// node, Holding a workplace): its workers and the armed residents guarding it.
pub const NPC_NODE_GUARD_RANGE: f64 = 12.0;

/// How many times the strength of a node's guards an NPC city's soldiers sent to take it must be
/// (`CONTEXT.md`: Taking a node): "far outweighs", as for a demand (`NPC_DEMAND_OUTWEIGH_TIMES`).
pub const NPC_TAKE_OUTWEIGH_TIMES: f64 = 4.0;

/// The fewest soldiers an NPC city sends to take a node, however weak its guards (`CONTEXT.md`:
/// Taking a node): two, so one can't be caught alone.
pub const NPC_TAKE_PARTY_MIN: f64 = 2.0;

/// How many soldiers an NPC city in Expand sends along with the crew building on a node out of its
/// City area (`CONTEXT.md`: Taking a node), as far as it has them beyond its hall and gate posts:
/// as many as a town's trader takes.
pub const NPC_SITE_ESCORTS: f64 = 2.0;

/// How many stops a round has along an NPC city's wall, spread evenly round it. Each costs one path
/// search; a town's wall of 180 tiles gives legs of about 22 tiles, some 3 game hours each.
pub const NPC_PATROL_WALL_STOPS: f64 = 8.0;

/// How many stops a round has along an NPC city's roads inside it, after those on its wall.
pub const NPC_PATROL_ROAD_STOPS: f64 = 3.0;

/// Coins an NPC city keeps as its war chest for each of its residents (`CONTEXT.md`: NPC reserve):
/// a town of 16 keeps 160, what four mint workers strike in two game days (`RECIPES`).
pub const NPC_WAR_CHEST_PER_RESIDENT: f64 = 10.0;

/// Spare sets of Tools an NPC city keeps in its reserve beyond one for each of its workers and
/// builders who carries none (`CONTEXT.md`: Tools, NPC reserve): enough for the next sets that
/// break before its smithy forges more.
pub const NPC_TOOLS_SPARE: f64 = 2.0;

/// How near to an NPC city's gate, in tiles, an armed outsider makes it close its gates
/// (`CONTEXT.md`: NPC city): a little inside sight, so the gate shuts before they reach it.
pub const NPC_GATE_WATCH_RANGE: f64 = 32.0;

/// An NPC city keeps one pair for every this many of its adults (`CONTEXT.md`: NPC city,
/// Pairing): a village of six one pair, a town of sixteen two. Only the partner carrying the child
/// stops working, and only for `CARRYING_DAYS`.
pub const NPC_ADULTS_PER_PAIR: f64 = 6.0;

/// Game days a partner carries a child before it is born (`CONTEXT.md`: Carrying), not working
/// meanwhile: 10 game days, 4 real hours.
pub const CARRYING_DAYS: f64 = 10.0;

/// Ticks from the start of carrying until the child is born (`CARRYING_DAYS`).
pub const CARRYING_TICKS: f64 = CARRYING_DAYS * TICKS_PER_GAME_DAY;

/// Game days a pair waits after pairing before one partner starts carrying (`CONTEXT.md`: Pairing),
/// if their city then has free housing and a food surplus: 5 game days, about 2 real hours
/// (Epic 113).
pub const PAIRING_WAIT_DAYS: f64 = 5.0;

/// Ticks from pairing until a partner can start carrying (`PAIRING_WAIT_DAYS`).
pub const PAIRING_WAIT_TICKS: f64 = PAIRING_WAIT_DAYS * TICKS_PER_GAME_DAY;
}

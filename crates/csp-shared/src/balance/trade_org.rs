//! The Trade Organization: its HQ and trading posts, prices, caravans, traders and deliveries.

use serde::Serialize;

use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeOrgHq {
    /// Tiles from the middle of the town hall to the inner ring of wall, which holds its warehouses.
    pub inner_radius: f64,
    /// Tiles from the middle of the town hall to the outer ring of wall; about twice an NPC town's
    /// width across.
    pub outer_radius: f64,
    /// Tiles from one outer ring to the next one it grows (`CONTEXT.md`: Trade Org HQ): as far as a
    /// city building reaches (`CITY_BUILDING_REACH`), so the new ring joins the HQ, with a band of
    /// houses between.
    pub ring_step: f64,
    /// Gates in each ring, evenly round it, the first due north.
    pub gates: f64,
    /// Adult residents, with random stats like a starting city's.
    pub residents: f64,
    /// Houses between the rings: room for everyone and one house more.
    pub houses: f64,
    /// Farms outside the outer ring, by its gates.
    pub farms: f64,
    /// Food in its storage, in units: about two weeks of what everyone eats.
    pub food: f64,
    /// Coins in its coin warehouse.
    pub coins: f64,
    /// Goods in its goods warehouse, in units.
    pub goods: Table<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradingPost {
    /// Tiles along each side, wall included: a village's square.
    pub size: f64,
    /// Adult residents: enough for its farm and its one workplace, besides the quarter it keeps as
    /// soldiers (`NPC_SOLDIER_SHARE`).
    pub residents: f64,
    /// Houses inside the wall: room for everyone.
    pub houses: f64,
    /// Farms outside the wall, by the gate.
    pub farms: f64,
    /// Food in its storage, in units: about 25 game days of what everyone eats.
    pub food: f64,
    /// Coins in its warehouse.
    pub coins: f64,
    /// Goods in its warehouse, in units: twice its floor (`WAREHOUSE_FLOOR`), so it has a market of every
    /// good until its first trader and caravan come by, and its soldiers' weapons. No steel weapons or
    /// armour: those come by caravan, so its soldiers start out on iron.
    pub goods: Table<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceRange {
    pub min: f64,
    pub max: f64,
}

balance! {
/// What the Trade Org HQ is placed with (`CONTEXT.md`: Trade Org HQ): a round city, the largest on
/// the map, with two rings of wall around its town hall.
pub const TRADE_ORG_HQ: TradeOrgHq = TradeOrgHq {
    inner_radius: 16.0,
    outer_radius: 40.0,
    ring_step: 12.0,
    gates: 4.0,
    residents: 32.0,
    houses: 9.0,
    farms: 4.0,
    food: 225.0,
    coins: 20_000.0,
    goods: Table(&[
        ("wood", 300.0),
        ("stone", 300.0),
        ("ironOre", 150.0),
        ("iron", 100.0),
        ("goldOre", 50.0),
        ("coal", 100.0),
        ("steel", 50.0),
    ]),
};

/// Starting cities lie at least this many tiles from the Trade Org HQ when the map has room
/// (`CITY_MIN_DISTANCE` for other starting cities), and the HQ is placed as far from every city
/// as the map allows.
pub const TRADE_ORG_HQ_MIN_DISTANCE: f64 = 1600.0;

/// How wide a square is for the frontier's trading posts (`CONTEXT.md`: Trading post), in tiles
/// along each side: the map is cut into a grid of about this size, and each square with no post
/// yet gets one on frontier land in it, if it has room. Every heartland has its own post near its
/// middle besides; no post stands on an island.
pub const TRADING_POST_REGION: f64 = 1440.0;

/// What a trading post is placed with (`CONTEXT.md`: Trading post): a walled village with a
/// warehouse. It keeps this size; it never grows.
pub const TRADING_POST: TradingPost = TradingPost {
    size: 29.0,
    residents: 6.0,
    houses: 2.0,
    farms: 1.0,
    food: 75.0,
    coins: 2_000.0,
    goods: Table(&[
        ("food", 40.0),
        ("wood", 50.0),
        ("stone", 50.0),
        ("ironOre", 20.0),
        ("iron", 10.0),
        ("goldOre", 10.0),
        ("coal", 20.0),
        ("steel", 10.0),
        ("spear", 4.0),
        ("sword", 2.0),
        ("shield", 4.0),
        ("armour", 2.0),
        ("tools", 4.0),
    ]),
};

/// A trading post's stock floor (`CONTEXT.md`: Stock floor, ADR 0023), in units: what its spare
/// hands, caravan and wandering traders go for, and what its prices are reckoned from. It tops up
/// nothing at a post; the HQ's warehouses top up to `HQ_FLOOR_FACTOR` times this each game day. Half
/// of what a post starts with, so a fresh post is well above it. A floor of 0 would mean warehouses
/// don't trade the good.
pub const WAREHOUSE_FLOOR: Table<f64> = Table(&[
    ("food", 20.0),
    ("wood", 25.0),
    ("stone", 25.0),
    ("ironOre", 10.0),
    ("iron", 5.0),
    ("goldOre", 5.0),
    ("coal", 10.0),
    ("steel", 5.0),
    ("coins", 1_000.0),
    ("spear", 2.0),
    ("sword", 1.0),
    ("shield", 2.0),
    ("armour", 1.0),
    ("steelSword", 1.0),
    ("steelShield", 1.0),
    ("steelArmour", 1.0),
    ("tools", 2.0),
    ("bow", 1.0),
    ("crossbow", 1.0),
    ("arrows", 40.0),
]);

/// How many times a trading post's floor (`WAREHOUSE_FLOOR`) the Trade Org HQ's warehouses keep.
pub const HQ_FLOOR_FACTOR: f64 = 5.0;

/// How many times a trading post's floor of Food the HQ's warehouse keeps, instead of
/// `HQ_FLOOR_FACTOR`: wandering traders alone carry Food to the posts (`CONTEXT.md`: Caravan, Wandering
/// trader) and it spoils on the way, so they leave the HQ with more of it, for the posts far along
/// their loop.
pub const HQ_FOOD_FLOOR_FACTOR: f64 = 15.0;

/// What a warehouse sells a unit of each good for, in coins, when it holds `PRICE_REFERENCE_FLOORS`
/// times its floor (`CONTEXT.md`: Warehouse prices, Price anchor). Roughly what goes into it: an
/// iron is two iron ore and the work, a sword two iron and a wood; gold ore stays below the 10
/// coins the mint strikes from it; coal, found only beyond the heartlands, a little above iron ore;
/// steel an iron and a coal and the work; steel weapons and armour their steel, wood and the work.
pub const WAREHOUSE_BASE_PRICE: Table<f64> = Table(&[
    ("food", 2.0),
    ("wood", 2.0),
    ("stone", 2.0),
    ("ironOre", 4.0),
    ("iron", 10.0),
    ("goldOre", 8.0),
    ("coal", 5.0),
    ("steel", 20.0),
    ("spear", 20.0),
    ("sword", 30.0),
    ("shield", 22.0),
    ("armour", 90.0),
    ("steelSword", 50.0),
    ("steelShield", 30.0),
    ("steelArmour", 160.0),
    ("tools", 25.0),
    ("bow", 12.0),
    ("crossbow", 30.0),
    ("arrows", 1.0),
]);

/// Stock, in floors, at which a warehouse sells at its base price; less stock costs more.
pub const PRICE_REFERENCE_FLOORS: f64 = 4.0;

/// How strongly prices follow stock: the sell price is the base price times (reference stock /
/// stock) to this power, so half the stock costs about 1.4 times as much.
pub const PRICE_ELASTICITY: f64 = 0.5;

/// The lowest and highest a sell price goes, as shares of the base price.
pub const PRICE_RANGE: PriceRange = PriceRange { min: 0.5, max: 4.0 };

/// The share of its sell price a warehouse pays when it buys (`CONTEXT.md`: Price anchor): it
/// buys low and sells high, so Players usually get better deals trading with each other.
pub const BUY_SHARE: f64 = 0.6;

/// Residents of the Trade Org HQ who walk along with each caravan as its escort, besides its
/// driver (`CONTEXT.md`: Caravan), on a route never robbed.
pub const CARAVAN_ESCORTS: f64 = 2.0;

/// Robberies of a route that earn its caravan one more escort (`CONTEXT.md`: Caravan, a route that
/// is attacked more often gets more escorts): the second robbery adds the first extra escort.
pub const CARAVAN_ROBBERIES_PER_ESCORT: f64 = 2.0;

/// The most escorts a caravan walks with, however often its route was robbed.
pub const CARAVAN_ESCORTS_MAX: f64 = 8.0;

/// Extra Food a caravan keeps on board for each escort beyond `CARAVAN_ESCORTS`, in units: the
/// same ~32 game days of `FOOD_PER_DAY` as `CARAVAN_FOOD`.
pub const CARAVAN_FOOD_PER_ESCORT: f64 = 16.0;

/// How near its carriage, in tiles, a caravan's escort defends it (`CONTEXT.md`: Caravan): they go
/// after robbers and attackers of the crew this close, and give up a chase that leads further.
pub const CARAVAN_GUARD_RANGE: f64 = 16.0;

/// Food a caravan keeps on board for its crew and its horse, in units, topped up at the storage
/// at each end of its route (`CONTEXT.md`: Caravan): a driver, two escorts and a horse eat 2.25 a
/// game day, so this lasts about 32 game days, twice the longest leg on a full-size map (~15).
pub const CARAVAN_FOOD: f64 = 72.0;

/// How much longer than a plain walk a carriage's way to its next stop may take, for the Food it waits
/// for at the HQ (`CONTEXT.md`: Waiting for Food): the escort sets its pace, and its way winds and
/// crosses slower ground. On the new land (ADR 0035) a trader's leg took 1.7 to 2.7 times the plain
/// walk in a game year's run (T100.8), its way going round Mountain ranges to a pass; 1.5 starved a
/// crew short of its post. A full-size map's longest ways want all of `CARAVAN_FOOD`, its cap.
pub const WAY_FOOD_MARGIN: f64 = 3.0;

/// What a carriage leaves in the HQ's storage (`CONTEXT.md`: Waiting for Food), in game days of what
/// its people off the carriages eat. No more than `NPC_FOOD_SHORT_DAYS`, below which the HQ puts
/// residents on its farms first, so the farms always bring the storage up past it.
pub const HQ_PEOPLE_FOOD_DAYS: f64 = 5.0;

/// Food a carriage waiting at the HQ may always hold, even from what the HQ's people are left
/// (`CONTEXT.md`: Waiting for Food), in units: its horse eats only from the load, and this is four
/// game days of it (`HORSE_FOOD_PER_DAY`).
pub const WAITING_HORSE_FOOD: f64 = 3.0;

/// How far under the Food for its way a carriage just set off from the HQ may hold (`CONTEXT.md`:
/// Waiting for Food; ADR 0004), in units: its horse goes on eating while its load goes on.
pub const SET_OFF_FOOD_SLACK: f64 = 2.0;

/// How many tiles further along their way a caravan's driver or an escort may get than the one
/// furthest behind (`CONTEXT.md`: Caravan): one ahead waits, so the escort keeps up with the
/// carriage.
pub const CARAVAN_SPREAD: f64 = 8.0;

/// How many wandering traders the HQ sends out (`CONTEXT.md`: Wandering trader), spread evenly round
/// one loop of all its posts and itself, or one for each post with fewer. A full-size map's loop takes
/// about 150 game days with its stops, so with six a post sees a trader about every 25 game days. They
/// are all that brings a post Food and Coins (ADR 0023): with four, posts far along the loop run out
/// of Food with nobody buying it, as it spoils between visits.
pub const TRADERS: f64 = 6.0;

/// Residents of the Trade Org HQ who walk along with each wandering trader as its escort, besides
/// its driver (`CONTEXT.md`: Wandering trader), before it was ever robbed: a caravan's.
pub const TRADER_ESCORTS: f64 = CARAVAN_ESCORTS;

/// How often a wandering trader's drive to a stop may end short of it before it goes on to the next
/// post (`CONTEXT.md`: Wandering trader), say out of reach of carriages, so one post can't hold up
/// the whole loop.
pub const TRADER_DRIVE_TRIES: f64 = 3.0;

/// How far from the straight way between two of its places a city's town hall may lie for a wandering
/// trader to stop at it on the way (`CONTEXT.md`: Trader stop), in tiles: under half the way between
/// NPC cities (`NPC_CITY_MIN_DISTANCE`), so about one or two stops a way and no long detours.
pub const TRADER_STOP_REACH: f64 = 200.0;

/// How many ticks a wandering trader stands at a stop (`CONTEXT.md`: Trader stop): a game day, long
/// enough for a Player who gets the notice to send someone over.
pub const TRADER_STOP_TICKS: f64 = 1440.0;

/// The share of a warehouse's floor (`WAREHOUSE_FLOOR`) a wandering trader prices each good from
/// (`CONTEXT.md`: Trader stop): a carriage holds far less than a warehouse, so a quarter makes
/// carrying one floor's worth of a good sell at about its base price.
pub const TRADER_FLOOR_SHARE: f64 = 0.25;

/// The part of a delivery's fee every delivery or pick-up pays, in coins (`CONTEXT.md`:
/// Delivery), however light or near.
pub const DELIVERY_FEE_BASE: f64 = 5.0;

/// The part of a delivery's fee that grows with weight and distance, in coins per kg and tile from
/// the warehouse to the city's storage (`CONTEXT.md`: Delivery). 100 kg over 400 tiles, about a
/// trading post's region, costs 50: a tenth of what 100 iron fetch, a lot for cheap Food.
pub const DELIVERY_FEE_PER_KG_TILE: f64 = 0.00125;

/// How often a caravan's drive towards a delivery's storage may end short of it before it turns
/// back (`CONTEXT.md`: Delivery), say behind closed gates or out of reach of carriages.
pub const DELIVERY_DRIVE_TRIES: f64 = 3.0;

/// How many times a delivery's fee a transfer between realms costs, for its weight over the
/// caravan's whole way (`CONTEXT.md`: Transfer): clearly higher, since the Trade Organization
/// carries for others what they could carry themselves. 100 iron over a region and back cost
/// about 300 coins.
pub const TRANSFER_FEE_FACTOR: f64 = 3.0;
}

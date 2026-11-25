//! Standing, crime and what it costs, the Trade Organization's punishments (and how fast Food
//! spoils, how long the realm log is and what a trip eats).

use serde::Serialize;

use super::*;
use crate::time::TICKS_PER_GAME_DAY;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrimeStandingLoss {
    pub theft: f64,
    pub attack: f64,
    pub tear_down: f64,
    pub killing: f64,
    /// A trading post captured (`CONTEXT.md`: Lost post found out): worse than any one killing.
    pub capture: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NpcTrade {
    /// Game days of Food for all its residents an NPC city keeps in reserve and never sells: more
    /// than its food surplus line (`FOOD_SURPLUS_DAYS`), so selling never stops it growing.
    pub reserve_food_days: f64,
    /// Stretches of wall whose materials it keeps in reserve, beside a house's (`BUILD_MATERIALS`),
    /// per step of its needs (`npcNeedsScale`): with a house that makes 68 Wood a step.
    pub reserve_wall_stretches: f64,
    /// Stone it keeps in reserve for each step of its needs past the first (`npcNeedsScale`), so a
    /// village keeps none: about a smelter's (`BUILD_MATERIALS`), or a road 40 tiles long.
    pub reserve_stone_per_step: f64,
    /// What it asks for each resident it lends and game week, in coins, at neutral standing: less
    /// than a Trade Org soldier (`TRADE_ORG_ARMY.pricePerSoldierWeek`), as they come mostly unarmed.
    pub price_per_resident_week: f64,
    /// Share of its adults, rounded up, it keeps at home to defend it and never lends.
    pub defence_share: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeOrgLoss {
    pub attack: f64,
    pub killing: f64,
    pub tear_down: f64,
    pub capture: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeOrgPunish {
    pub times: f64,
    pub soldiers: f64,
    pub give_up_days: f64,
    /// How much longer a walk takes than the same distance straight over Plains, for the Food packed:
    /// Forest and Hills go at 0.7 of the speed, and the way winds around what can't be crossed.
    pub walk_margin: f64,
    /// Kilos a soldier keeps free as they pack at the HQ, whatever the trip asks for, for what they
    /// will carry home: 150 Coins. Eating on the way there makes more room by the time they take it.
    pub pack_room: f64,
    /// Tiles from a place within which a soldier short of Food counts as passing it and goes to refill
    /// or buy: about a third of a game day's walk, little against what it brings.
    pub post_reach: f64,
    /// Coins a soldier packs at the HQ to buy Food on the way (`CONTEXT.md`: Trade Org debt): the
    /// longest trip's Food at about three Coins a unit, 1.2 kg of their hands. What is left goes back
    /// into the HQ's coin warehouse when they are home.
    pub purse: f64,
    /// The most Coins a soldier pays for a unit of Food at a Player's offer: three times what a
    /// warehouse asks at its usual stock. Above that they pass it by, or an offer of one Food at any
    /// price would empty their purse.
    pub offer_food_price: f64,
    /// How many times the straight walk over Plains it keeps trying to reach the city (never less
    /// than `giveUpDays`). Past that it has no way there, as with every gate shut, and turns back.
    pub road_times: f64,
    /// Kilos its supply wagon keeps free of Food, whatever the trip asks for, for what the army takes
    /// (`CONTEXT.md`: Trade Org debt): a quarter of a carriage, 5,000 Coins or 100 Iron.
    pub wagon_room: f64,
    /// Tiles from its supply wagon within which a soldier carries what they took over to it, rather
    /// than on home: as far as they would go for a trading post (`postReach`).
    pub wagon_reach: f64,
    /// Ticks between a supply wagon's tries to set off after its army: only a failed search for a way
    /// tries again, and these keep a wagon with no way from searching every tick.
    pub wagon_retry_ticks: f64,
    /// Tiles from its army within which a supply wagon goes after them step by step, finding its way
    /// again as they move. Further behind it first drives to where they were: a search that far takes
    /// longer than they take to move on, so it would never end.
    pub wagon_follow_reach: f64,
}

balance! {
/// Share of the Food in one place (a storage, a resident's or carriage's load, a pile) that goes
/// bad each game day (`CONTEXT.md`: Spoilage). Half of a stock is gone in about 140 game days.
pub const FOOD_SPOIL_PER_DAY: f64 = 0.005;

/// Events kept in each Player's realm log; the oldest go first. A Player who logs
/// in sees these, so a few game days of a busy realm should fit.
pub const REALM_LOG_LENGTH: f64 = 100.0;

/// How long, in game days, an Organization remembers a crime once it is known and nobody carries
/// news of it any more (`CONTEXT.md`: Crime). About seven real hours: long enough to count as
/// "recent".
pub const CRIME_MEMORY_DAYS: f64 = 18.0;

/// How far standing goes each way from neutral (`CONTEXT.md`: Standing): -100 to +100.
pub const STANDING_RANGE: f64 = 100.0;

/// What a crime costs in the victim's standing toward the culprit's Organization once the victim
/// knows of it (`CONTEXT.md`: Standing). Killing is the worst; a theft is forgiven soonest.
pub const CRIME_STANDING_LOSS: CrimeStandingLoss =
    CrimeStandingLoss { theft: 10.0, attack: 15.0, tear_down: 20.0, killing: 30.0, capture: 50.0 };

/// Coins of trade that raise standing by one point, both ways between the trader's realm and the
/// Trade Organization, or between two realms (`CONTEXT.md`: Standing). About two spears' worth.
pub const STANDING_TRADE_COINS_PER_POINT: f64 = 50.0;

/// Coins of trade that raise standing by one point, both ways between the trader's realm and an NPC
/// city (`CONTEXT.md`: Standing, Trading with an NPC city). A village's surplus grows by about 12
/// coins' worth a game day, so buying half of it and selling back half of that holds about 0.9 points
/// a game day against a drift of `STANDING_DRIFT_PER_DAY`: `PERSUADE_STANDING` in about two real days
/// for a Player who trades there regularly.
pub const STANDING_NPC_TRADE_COINS_PER_POINT: f64 = 10.0;

/// Standing each paid game week of a mercenary contract raises, both ways between its sides.
pub const STANDING_PER_PAID_WEEK: f64 = 0.8;

/// What a contract broken by an unpaid week costs in the lender's standing toward the hirer.
pub const STANDING_CONTRACT_BROKEN_LOSS: f64 = 20.0;

/// Points standing drifts back toward neutral each game day (`CONTEXT.md`: Standing): a killing is
/// forgotten in about 75 game days, a little over a real day.
pub const STANDING_DRIFT_PER_DAY: f64 = 0.4;

/// Below this standing toward an Organization an NPC city won't trade with it or hire out to it
/// and keeps its gates shut to its residents (`CONTEXT.md`: NPC city reaction). A killing known
/// to it, not a single theft or attack.
pub const NPC_CITY_REFUSES_STANDING: f64 = -25.0;

/// Below this standing toward a realm an NPC city won't sell itself to it at all (`CONTEXT.md`:
/// NPC city reaction). Two killings known to it.
pub const NPC_CITY_WONT_SELL_STANDING: f64 = -60.0;

/// How far standing moves an NPC city's price (`CONTEXT.md`: Buying a city): its price times
/// 1 - this × standing / `STANDING_RANGE`, so half price at the best standing and half again as
/// much at the worst.
pub const CITY_PRICE_STANDING_SWING: f64 = 0.5;

/// Trading with and hiring from an NPC city (`CONTEXT.md`: Trading with / Hiring from an NPC city).
pub const NPC_TRADE: NpcTrade = NpcTrade {
    reserve_food_days: 15.0,
    reserve_wall_stretches: 16.0,
    reserve_stone_per_step: 40.0,
    price_per_resident_week: 5.0,
    defence_share: 0.25,
};

/// The standing an NPC city needs toward a realm before it asks to join it (`CONTEXT.md`:
/// Persuading a city): "high standing", where the standing list starts calling it trusted.
pub const PERSUADE_STANDING: f64 = 50.0;

/// How often, in ticks, an NPC city weighs whether to ask a realm to join (`CONTEXT.md`:
/// Persuading a city): once a game hour (a real minute), so standing and respect aren't counted
/// every tick.
pub const PERSUADE_CHECK_TICKS: f64 = 60.0;

/// Game days an NPC city waits after a realm declined it before it asks that realm again
/// (`CONTEXT.md`: Persuading a city). As long as a remembered crime.
pub const PERSUADE_ASK_AGAIN_DAYS: f64 = 18.0;

/// The standing a self-managed city starts out holding its former Player in (`CONTEXT.md`:
/// Self-managed city): good, and like any standing gone in about 150 game days, two and a half
/// real days.
pub const FORMER_PLAYER_STANDING: f64 = 60.0;

/// Below this standing toward an Organization the Trade Organization refuses to trade with it
/// (`CONTEXT.md`: Trade Org reaction): no buying or selling at its warehouses, no hiring its
/// soldiers, no hiring theirs. Any known crime against it gets there; a theft is forgiven in about
/// 12 game days.
pub const TRADE_ORG_REFUSES_TRADE_BELOW: f64 = -5.0;

/// Below this standing toward an Organization the Trade Organization sends its army to punish it
/// for the crimes against it it knows of (`CONTEXT.md`: Trade Org reaction). Lower than refusing
/// trade, and still above what a single theft costs, since it punishes anyone who steals from it
/// (`CONTEXT.md`: Self-interest).
pub const TRADE_ORG_PUNISHES_BELOW: f64 = -8.0;

/// What a crime costs the Trade Organization in Coins, besides stolen goods, which are worth their
/// warehouse base price (`WAREHOUSE_BASE_PRICE`): a resident wounded, one killed (worth as much as
/// a resident in a city's price, `CITY_PRICE_PER_RESIDENT`), a building torn down, or a trading post
/// captured (what a city of its adults would be priced at).
pub const TRADE_ORG_LOSS: TradeOrgLoss = TradeOrgLoss {
    attack: 50.0,
    killing: CITY_PRICE_PER_RESIDENT,
    tear_down: 150.0,
    capture: CITY_PRICE_PER_RESIDENT * TRADING_POST.residents,
};

/// What a stolen carriage is worth in Coins (`CONTEXT.md`: Stealing a carriage or horse), besides
/// its load: about its materials at their warehouse base price (`BUILD_MATERIALS.carriage`, 110
/// Coins) and two game days of a builder's work.
pub const CARRIAGE_STOLEN_WORTH: f64 = 150.0;

/// What a stolen horse is worth in Coins (`CONTEXT.md`: Stealing a carriage or horse): less than a
/// carriage, as it takes only two horses and a resident's time to breed one.
pub const HORSE_STOLEN_WORTH: f64 = 100.0;

/// How the Trade Organization's army punishes (`CONTEXT.md`: Trade Org reaction): it takes back
/// `times` what it lost, sends at most `soldiers` of its spare soldiers, and gives up and goes
/// home after `giveUpDays` game days at the city, from when it arrived (`CONTEXT.md`: Punishment
/// trip), if it can't get it all.
pub const TRADE_ORG_PUNISH: TradeOrgPunish = TradeOrgPunish {
    times: 2.0,
    soldiers: 8.0,
    give_up_days: 12.0,
    walk_margin: 1.4,
    pack_room: 3.0,
    post_reach: 60.0,
    purse: 60.0,
    offer_food_price: 6.0,
    road_times: 3.0,
    wagon_room: 100.0,
    wagon_reach: 60.0,
    wagon_retry_ticks: 60.0,
    wagon_follow_reach: 48.0,
};

/// What the Trade Organization's army comes to take, in Coins' worth, each time it goes out against
/// the target of an admin directive (`CONTEXT.md`: Admin directive), which names no crimes to weigh
/// it by: as much as it takes back for a killing (`TRADE_ORG_PUNISH.times` its loss). It goes again
/// as soon as one punishment is over, until the directive is lifted.
pub const DIRECTIVE_PUNISH_WORTH: f64 = TRADE_ORG_PUNISH.times * TRADE_ORG_LOSS.killing;

/// The price, in Coins, the admin panel offers for buying off an admin directive (`CONTEXT.md`:
/// Admin directive) when an admin allows it; they may set another. About a couple of punishments'
/// worth (`DIRECTIVE_PUNISH_WORTH`), and 30 kg of coins: an average resident's hands or a carriage
/// can bring it.
pub const DIRECTIVE_BUY_OFF_PRICE: f64 = 1500.0;
}

/// Food for a walk of `tiles` on a punishment trip (`CONTEXT.md`: Punishment trip), in whole units:
/// at `FOOD_PER_DAY`, the walk taking `TRADE_ORG_PUNISH.walkMargin` times the straight way over
/// Plains.
pub fn trip_food(tiles: f64) -> f64 {
    let days = (tiles * WALK_TICKS_PER_TILE * TRADE_ORG_PUNISH.walk_margin) / TICKS_PER_GAME_DAY;
    (days * FOOD_PER_DAY).ceil()
}

/// The Food a supply wagon means to set out with (`CONTEXT.md`: Trade Org debt), for `soldiers` going
/// `tiles` there and back as much: all of the trip's for each of them, as they may pack little, for
/// its driver and for its horse. A carriage takes it only as far as it keeps
/// `TRADE_ORG_PUNISH.wagonRoom` free.
pub fn wagon_food_for(tiles: f64, soldiers: f64) -> f64 {
    let walk = trip_food(2.0 * tiles);
    let stay = TRADE_ORG_PUNISH.give_up_days * FOOD_PER_DAY;
    let horse = ((walk + stay) / FOOD_PER_DAY) * HORSE_FOOD_PER_DAY;
    ((soldiers + 1.0) * (walk + stay) + horse).ceil()
}

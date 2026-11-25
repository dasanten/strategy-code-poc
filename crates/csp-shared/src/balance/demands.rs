//! Demands, threat and danger, and Direct offers.

balance! {
/// The longest note a demand may carry, in characters (`CONTEXT.md`: Demand): a few sentences, as
/// "give the city back or we attack" takes, and few enough to keep them cheap to store and show.
pub const DEMAND_NOTE_MAX_LENGTH: f64 = 280.0;

/// How many demands a realm may send in any one game day (`CONTEXT.md`: Demand): about seven a
/// real hour, plenty for a war and little for spam. Scripts count too.
pub const DEMANDS_PER_GAME_DAY: f64 = 3.0;

/// The longest deadline a demand may set, in game days (`CONTEXT.md`: Demand): one real day, so a
/// Player who comes by once a day can still answer.
pub const DEMAND_MAX_DAYS: f64 = 60.0;

/// The deadline of the Trade Organization's demand for a debt, in game days (`CONTEXT.md`: Trade Org
/// debt): one real day, the longest a demand has, so a Player who comes by once a day can still pay.
pub const TRADE_ORG_DEBT_DEMAND_DAYS: f64 = 60.0;

/// How many of the Trade Organization's armies come to tear down workplaces for a debt before its next
/// one comes to hold the town hall and take the city (`CONTEXT.md`: Trade Org debt): two, so a Player
/// who loses workplaces once and again still has time to pay before it comes to that.
pub const TRADE_ORG_DEBT_TRIPS: f64 = 2.0;

/// The deadline the Demands form starts with, in game days: a game week.
pub const DEMAND_DEFAULT_DAYS: f64 = 7.0;

/// How many times its own side, by strength, the respect an NPC city sees from a realm must be
/// before it yields to that realm's demand (`CONTEXT.md`: Demand, Respect; ADR 0033): "far
/// outweighs". More than three, so three times its soldiers' number in residents geared and trained
/// like them isn't enough: it takes better gear or training, or many more. Persuading a city takes
/// only more than its own side.
pub const DEMAND_YIELD_RESPECT_TIMES: f64 = 4.0;

/// The least respect an NPC city yields to a demand for, however weak its own side (`CONTEXT.md`:
/// Demand): five untrained residents with spears (5 each), so a city without soldiers doesn't give
/// in to one or two.
pub const DEMAND_YIELD_RESPECT_MIN: f64 = 25.0;

/// What each finished wall or gate tile of an NPC city adds to its own side when it weighs respect
/// (`CONTEXT.md`: Respect; ADR 0033): a twentieth of an untrained resident with a spear, so a
/// village ringed by some forty tiles counts two soldiers more.
pub const RESPECT_PER_WALL: f64 = 0.25;

/// How long, in game days, a realm's force near an NPC city must outweigh it without a break before
/// it yields to that realm's demand or asks to join it (`CONTEXT.md`: Demand, Persuading a city;
/// ADR 0033): a game day, so an army has to camp at the gate (24 planning passes) and others
/// have time to come to help, and one army can't collect villages by walking through.
pub const OUTWEIGH_HOLD_DAYS: f64 = 1.0;

/// Threat an NPC city takes from an Organization for each point of its armed residents' strength
/// (as respect weighs them) it sees near itself or its people for a whole game day (`CONTEXT.md`:
/// Threat). An untrained spearman passing in sight for a game hour adds about a fifth; ten of them
/// camped at the gate for a day add about fifty.
pub const THREAT_SEEN_PER_DAY: f64 = 1.0;

/// Threat an NPC city takes from an Organization once it knows that one killed one of its people
/// (`CONTEXT.md`: Threat): as much as the standing it loses for it.
pub const THREAT_PER_KILLING: f64 = 30.0;

/// Threat an NPC city takes from an Organization once it knows that one robbed it (`CONTEXT.md`:
/// Threat): as much as the standing it loses for it.
pub const THREAT_PER_ROBBERY: f64 = 10.0;

/// Game days for an NPC city's threat to fade to half (`CONTEXT.md`: Threat): a killing is down to
/// what it forgets in about 25 game days, some ten real hours.
pub const THREAT_HALF_LIFE_DAYS: f64 = 3.0;

/// Below this an NPC city forgets a threat (`CONTEXT.md`: Threat): under what one untrained
/// spearman in sight for a planning pass adds, so a passer-by is remembered for a few game days.
pub const THREAT_FORGOTTEN: f64 = 0.1;

/// Game days for a danger place to fade to half (`CONTEXT.md`: Threat): a place where one person
/// was lost is forgotten after twelve game days.
pub const DANGER_PLACE_HALF_LIFE_DAYS: f64 = 6.0;

/// Below this weight an NPC city forgets a danger place (`CONTEXT.md`: Threat). A place starts at
/// one for each person lost there.
pub const DANGER_PLACE_FORGOTTEN: f64 = 0.25;

/// Tiles within which a new loss counts toward a danger place the city already remembers instead
/// of being a new one (`CONTEXT.md`: Threat).
pub const DANGER_PLACE_MERGE_RANGE: f64 = 8.0;

/// Tiles from a way within which a danger place makes it dangerous (`CONTEXT.md`: Threat, Escort).
pub const DANGER_PLACE_WAY_REACH: f64 = 12.0;

/// Most soldiers an NPC city sends along beyond its usual escort on a dangerous way: one for each
/// person it lost by the way, rounded up while it remembers, up to this (`CONTEXT.md`: Threat,
/// Escort).
pub const DANGER_ESCORTS_MAX: f64 = 3.0;

/// What an NPC city's standing toward a realm drops by when it declines that realm's demand
/// (`CONTEXT.md`: Demand): as much as a theft, so three in a game day shut its gates.
pub const DEMAND_DECLINED_STANDING_LOSS: f64 = 10.0;

/// What the Trade Organization's standing toward a realm drops by for being sent a demand
/// (`CONTEXT.md`: Demand). Small, as it refuses trade and sends its army at small numbers
/// (`TRADE_ORG_REFUSES_TRADE_BELOW`, `TRADE_ORG_PUNISHES_BELOW`): it takes several to matter.
pub const DEMAND_TRADE_ORG_STANDING_LOSS: f64 = 2.0;

/// How long a Direct offer stands, in game days (`CONTEXT.md`: Direct offer): one real day, so a
/// Player who comes by once a day can still answer and send someone. The sender can take it down
/// sooner.
pub const DIRECT_OFFER_DAYS: f64 = 60.0;

/// How many Direct offers a realm may have standing to any one realm (`CONTEXT.md`: Direct offer):
/// room to deal in several goods at once, and few enough that it can't flood the other's list.
pub const DIRECT_OFFERS_TO_ONE_REALM: f64 = 5.0;
}

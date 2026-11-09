//! Demands (`apps/server/src/demands.ts`, `CONTEXT.md`: Demand; ADR 0024): a realm sends another
//! realm it knows of terms, a note and a deadline. It arrives at once, wherever the other is. They
//! accept or decline it, or let it lapse, and both realm logs say so. Accepting carries out the
//! terms. Otherwise it is only words. The game answers for an NPC city and the Trade Organization,
//! at the next planning pass (ADR 0016).

use csp_shared::balance::{
    DEMANDS_PER_GAME_DAY, DEMAND_DECLINED_STANDING_LOSS, DEMAND_MAX_DAYS, DEMAND_NOTE_MAX_LENGTH,
    DEMAND_TRADE_ORG_STANDING_LOSS, NPC_PLAN_TICKS, TRADE_ORG_DEBT_DEMAND_DAYS, TRADE_ORG_LOSS,
};
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, City, Debt, DebtStep, DebtWhat, Demand, DemandHandedOver, DemandOtherIs, DemandSide,
    DemandTerms, DemandWhat, Good, OrderRequest, RealmEventWhat, Remembered, Stock, WorldState,
};
use serde_json::Value;

use crate::capture::{hand_over_city, return_post};
use crate::events::record_event;
use crate::goods_deps::{new_id, realm_name};
use crate::invariants::InvariantViolation;
use crate::npc_plan::plan_due;
use crate::offers::{sees_storage_of, set_aside_for_demand};
use crate::order_sender::OrderSender;
use crate::orders::OrderKind;
use crate::queries::alliance_rules::is_alliance_city;
use crate::queries::city::for_sale;
use crate::queries::demand::{
    answered_by_game, demand_hand_over, demand_hand_over_problem, demand_note_problem,
    demands_counted, demands_left, goods_handed_over, goods_to_hand_over, npc_orgs_known_to,
    realms_known_to, transfer_loads, yields_to_demand, AnsweredBy, DemandHandOver,
};
use crate::queries::goods::free_stock;
use crate::queries::names::good_of;
use crate::queries::npc_trade::npc_storages;
use crate::queries::offers::offer_storage;
use crate::queries::standing::{organization_label, standing_organization, TRADE_ORG};
use crate::queries::warehouse_trade::delivery_storage;
use crate::sight::{sight_of, Spot};
use crate::standing::change_standing;
use crate::transfers::{order_debt_collection, order_pick_up};
use crate::world_index::WorldIndex;

fn text<'o>(order: &'o OrderRequest, k: &str) -> Option<&'o str> {
    order.fields.get(k).and_then(Value::as_str)
}

/// The Player's realm's index (`realmOf`).
fn realm_of(world: &WorldState, user_id: u64) -> Option<usize> {
    world.realms.iter().position(|r| r.user_id == user_id)
}

/// Whether the realm has anyone of `to_id`'s in sight, on a map of `size` tiles when known
/// (`seesResidentsOf`).
fn sees_residents_of(world: &WorldState, realm_id: &str, to_id: &str, size: Option<i32>) -> bool {
    let Some(size) = size else { return false };
    let index = WorldIndex::new(world, size);
    let eyes = sight_of(world, &index, realm_id, None);
    world
        .residents
        .iter()
        .any(|r| r.owner.as_deref() == Some(to_id) && eyes.sees(Spot { x: r.x, y: r.y }))
}

/// A city as a realm knows it (`knownCity`): its name, its realm and whether it is the Trade
/// Organization's.
struct KnownCity {
    name: String,
    realm_id: Option<String>,
    trade_org: bool,
}

/// The city as the realm knows it (`knownCity`): as it stands while the realm sees any of it,
/// else as it last saw it (`CONTEXT.md`: Last seen). `None` when it doesn't know the city.
fn known_city(
    world: &WorldState,
    realm: usize,
    city_id: Option<&str>,
    size: Option<i32>,
) -> Option<KnownCity> {
    let realm = &world.realms[realm];
    let city = world.cities.iter().find(|c| Some(c.id.as_str()) == city_id);
    if let (Some(city), Some(size)) = (city, size) {
        let index = WorldIndex::new(world, size);
        let eyes = sight_of(world, &index, &realm.id, None);
        let seen = world.buildings.iter().any(|b| {
            b.city_id.as_deref() == Some(city.id.as_str()) && eyes.sees(Spot { x: b.x, y: b.y })
        });
        if seen {
            return Some(KnownCity {
                name: city.name.clone(),
                realm_id: city.realm_id.clone(),
                trade_org: city.trade_org.is_some(),
            });
        }
    }
    world.last_seen.get(&realm.user_id)?.iter().find_map(|m| match m {
        Remembered::City(c) if Some(c.id.as_str()) == city_id => Some(KnownCity {
            name: c.name.clone(),
            realm_id: c.realm_id.clone(),
            trade_org: c.trade_org.is_some(),
        }),
        _ => None,
    })
}

/// `Number.isSafeInteger`.
fn safe_integer(n: f64) -> bool {
    n.fract() == 0.0 && n.abs() <= 9_007_199_254_740_991.0
}

/// The goods a demand names as plain data, or a reason they are not good (`readGoods`).
fn read_goods(goods: Option<&Value>) -> Result<Stock, String> {
    let Some(goods) = goods.and_then(Value::as_object) else {
        return Err("name the goods and how many of each".into());
    };
    let mut out = Stock::new();
    for (name, n) in goods {
        let Some(good) = good_of(name) else { return Err(format!("no such good: {name}")) };
        let n = n.as_f64().filter(|n| safe_integer(*n) && *n >= 1.0);
        let Some(n) = n else { return Err("demand a whole number of each good".into()) };
        out.insert(good, n);
    }
    if out.is_empty() {
        return Err("name the goods and how many of each".into());
    }
    Ok(out)
}

/// What a demand asks for as plain data, or a reason it can't be asked for (`readTerms`).
fn read_terms(
    world: &WorldState,
    realm: usize,
    to_id: &str,
    terms: Option<&Value>,
    size: Option<i32>,
) -> Result<DemandTerms, String> {
    let field = |k: &str| terms.and_then(|t| t.get(k));
    let kind = field("kind").and_then(Value::as_str);
    if kind == Some("goods") {
        return read_goods(field("goods")).map(|goods| DemandTerms::Goods { goods });
    }
    if kind != Some("city") {
        return Err("demand a named city, or goods or Coins".into());
    }
    let city_id = field("cityId").and_then(Value::as_str);
    let city = known_city(world, realm, city_id, size);
    if answered_by_game(world, to_id) == Some(AnsweredBy::City) {
        // It knows itself, also where the sender knows it only by a standing.
        if city_id != Some(to_id) {
            return Err("an NPC city can only hand over itself".into());
        }
        let city_name = city.map_or_else(|| organization_label(world, to_id), |c| c.name);
        return Ok(DemandTerms::City { city_id: to_id.to_string(), city_name });
    }
    let Some(city) = city else { return Err("you don’t know of that city".into()) };
    let theirs =
        if to_id == TRADE_ORG { city.trade_org } else { city.realm_id.as_deref() == Some(to_id) };
    if !theirs {
        return Err("as far as you know, that city isn’t theirs".into());
    }
    Ok(DemandTerms::City { city_id: city_id.unwrap_or_default().to_string(), city_name: city.name })
}

/// Whether the realm knows of `to_id`, a realm or what the game answers for (`knowsOf`).
fn knows_of(world: &WorldState, realm: usize, to_id: &str, size: Option<i32>) -> bool {
    let realm_id = &world.realms[realm].id;
    if answered_by_game(world, to_id).is_none() {
        return realms_known_to(world, realm_id, []).iter().any(|r| r == to_id)
            || sees_residents_of(world, realm_id, to_id, size);
    }
    npc_orgs_known_to(world, realm_id, []).iter().any(|r| r == to_id)
        || known_city(world, realm, Some(to_id), size).is_some_and(|c| c.realm_id.is_none())
}

/// `String.prototype.trim`.
fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

/// A demand as plain data, not yet sent, or a reason it can't be sent (`readDemand`).
fn read_demand(
    world: &WorldState,
    realm: usize,
    order: &OrderRequest,
    size: Option<i32>,
) -> Result<Demand, String> {
    let tick = world.tick as f64;
    let r = &world.realms[realm];
    if demands_left(r, tick) == 0.0 {
        return Err(format!("a realm can send at most {DEMANDS_PER_GAME_DAY} demands a game day"));
    }
    let to = order.fields.get("realmId");
    if to.and_then(Value::as_str) == Some(r.id.as_str()) {
        return Err("send a demand to another realm".into());
    }
    let Some(to) = to.and_then(Value::as_str) else {
        return Err("send a demand to a realm".into());
    };
    // A trading post's id names the Trade Organization, whose cities are all one Organization.
    let to_id = standing_organization(world, to).to_string();
    if !knows_of(world, realm, &to_id, size) {
        let named = world.realms.iter().any(|x| x.id == to_id) || is_alliance_city(world, &to_id);
        return Err(if named {
            "you don’t know of that realm"
        } else {
            "send a demand to a realm"
        }
        .into());
    }
    let terms = read_terms(world, realm, &to_id, order.fields.get("terms"), size)?;
    if let Some(p) = demand_note_problem(order.fields.get("note")) {
        return Err(p);
    }
    let days = order.fields.get("days").and_then(Value::as_f64);
    let Some(days) = days.filter(|d| d.fract() == 0.0 && *d >= 1.0 && *d <= DEMAND_MAX_DAYS) else {
        return Err(format!("a deadline is 1 to {DEMAND_MAX_DAYS} game days away"));
    };
    Ok(Demand {
        id: String::new(),
        from_id: r.id.clone(),
        to_id,
        terms,
        note: js_trim(text(order, "note").unwrap_or_default()).to_string(),
        sent_at: tick,
        deadline: tick + days * TICKS_PER_GAME_DAY,
    })
}

/// What else an event about a demand says (`extra` of `tellBoth`).
#[derive(Default)]
struct Extra {
    leader_died: Option<DemandSide>,
    handed_over: Option<DemandHandedOver>,
}

/// An event about the demand for both its sides (`tellBoth`). Call it while both realms still
/// stand.
fn tell_both(
    world: &mut WorldState,
    d: &Demand,
    sender: DemandWhat,
    receiver: DemandWhat,
    extra: Extra,
) {
    let other_is = answered_by_game(world, &d.to_id).map(|a| match a {
        AnsweredBy::TradeOrg => DemandOtherIs::TradeOrg,
        AnsweredBy::City => DemandOtherIs::City,
    });
    let sender_is = (d.from_id == TRADE_ORG).then_some(DemandOtherIs::TradeOrg);
    let to_sender = RealmEventWhat::Demand {
        demand_id: d.id.clone(),
        what: sender,
        mine: true,
        other: organization_label(world, &d.to_id),
        other_is,
        terms: d.terms.clone(),
        leader_died: extra.leader_died,
        handed_over: extra.handed_over.clone(),
    };
    record_event(world, Some(&d.from_id), to_sender);
    let to_receiver = RealmEventWhat::Demand {
        demand_id: d.id.clone(),
        what: receiver,
        mine: false,
        other: realm_name(world, &d.from_id),
        other_is: sender_is,
        terms: d.terms.clone(),
        leader_died: extra.leader_died,
        handed_over: extra.handed_over,
    };
    record_event(world, Some(&d.to_id), to_receiver);
}

/// Sending a demand (`sendDemand`): it is there for the other side at once.
pub struct SendDemand;

impl OrderKind for SendDemand {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        let Some(realm) = realm_of(world, sender.user_id) else {
            return Some("you have no realm".into());
        };
        read_demand(world, realm, order, terrain.map(|t| t.size)).err()
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        let Some(realm) = realm_of(world, sender.user_id) else { return };
        // Several may have come in this tick: the limit holds for what `validate` let through.
        let Ok(mut demand) = read_demand(world, realm, order, terrain.map(|t| t.size)) else {
            return;
        };
        demand.id = new_id(world, "demand");
        world.demands.push(demand.clone());
        let tick = world.tick as f64;
        let mut sent = demands_counted(&world.realms[realm], tick);
        sent.push(tick);
        world.realms[realm].demands_sent_at = Some(sent);
        tell_both(world, &demand, DemandWhat::Sent, DemandWhat::Received, Extra::default());
    }
}

/// The demand `demandId` sent to the Player's realm, or a reason it can't be answered
/// (`demandToAnswer`).
fn demand_to_answer(
    world: &WorldState,
    user_id: u64,
    order: &OrderRequest,
) -> Result<Demand, String> {
    let Some(realm) = realm_of(world, user_id) else { return Err("you have no realm".into()) };
    let realm_id = &world.realms[realm].id;
    let id = text(order, "demandId");
    let d = world.demands.iter().find(|x| Some(x.id.as_str()) == id);
    let Some(d) = d.filter(|d| &d.from_id == realm_id || &d.to_id == realm_id) else {
        return Err("no such demand".into());
    };
    if &d.to_id != realm_id {
        return Err("only the realm it was sent to can answer it".into());
    }
    Ok(d.clone())
}

/// The answer a demand got.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Answer {
    Accepted,
    Declined,
    Lapsed,
}

/// A demand answered: it goes, and both realm logs say so (`answered`).
fn answered(
    world: &mut WorldState,
    d: &Demand,
    answer: Answer,
    handed_over: Option<DemandHandedOver>,
) {
    world.demands.retain(|x| x.id != d.id);
    let what = match answer {
        Answer::Accepted => DemandWhat::Accepted,
        Answer::Declined => DemandWhat::Declined,
        Answer::Lapsed => DemandWhat::Lapsed,
    };
    tell_both(world, d, what, what, Extra { leader_died: None, handed_over });
    if answer != Answer::Accepted {
        debt_demand_ended(world, d);
    }
}

/// What the Trade Organization writes in its demand for a debt (`DEBT_DEMAND_NOTE`).
pub const DEBT_DEMAND_NOTE: &str = "Pay what you owe at any of our warehouses, or hand it over here. Past the deadline our army comes for your workplaces.";

/// The Trade Organization demands a debt of who owes it (`sendDebtDemand`, `CONTEXT.md`: Trade
/// Org debt), for all that is owed, the first of its steps (ADR 0025). `debt` is its index in
/// `world.debts`.
pub fn send_debt_demand(world: &mut WorldState, debt: usize) {
    let tick = world.tick as f64;
    let (org, coins) = (world.debts[debt].org.clone(), world.debts[debt].coins);
    let demand = Demand {
        id: new_id(world, "demand"),
        from_id: TRADE_ORG.into(),
        to_id: org,
        terms: DemandTerms::Goods { goods: [(Good::Coins, coins)].into_iter().collect() },
        note: DEBT_DEMAND_NOTE.into(),
        sent_at: tick,
        deadline: tick + TRADE_ORG_DEBT_DEMAND_DAYS * TICKS_PER_GAME_DAY,
    };
    world.demands.push(demand.clone());
    world.debts[debt].step = Some(DebtStep::Demanded);
    world.debts[debt].deadline = Some(demand.deadline);
    tell_both(world, &demand, DemandWhat::Sent, DemandWhat::Received, Extra::default());
}

/// What the Trade Organization writes in its demand for a captured post (`POST_DEMAND_NOTE`).
pub const POST_DEMAND_NOTE: &str = "You took our trading post. Give it back and that settles what it is worth, or pay that at any of our warehouses. Past the deadline our army comes for your workplaces.";

/// The Trade Organization demands of `org` the post it took and still holds (`sendPostDemand`,
/// `CONTEXT.md`: Trade Org debt), once it has heard of it.
pub fn send_post_demand(world: &mut WorldState, org: &str, city: &City) {
    let tick = world.tick as f64;
    let demand = Demand {
        id: new_id(world, "demand"),
        from_id: TRADE_ORG.into(),
        to_id: org.to_string(),
        terms: DemandTerms::City { city_id: city.id.clone(), city_name: city.name.clone() },
        note: POST_DEMAND_NOTE.into(),
        sent_at: tick,
        deadline: tick + TRADE_ORG_DEBT_DEMAND_DAYS * TICKS_PER_GAME_DAY,
    };
    world.demands.push(demand.clone());
    tell_both(world, &demand, DemandWhat::Sent, DemandWhat::Received, Extra::default());
}

/// The post comes back to the Trade Organization, which settles its worth of what `org` owes
/// (`postGivenBack`), and only that.
fn post_given_back(world: &mut WorldState, org: &str, city_id: &str, size: i32) {
    return_post(world, city_id, size);
    let Some(i) = world.debts.iter().position(|x| x.org == org) else { return };
    let off = world.debts[i].coins.min(TRADE_ORG_LOSS.capture);
    world.debts[i].coins -= off;
    let owed = world.debts[i].coins;
    if owed <= 0.0 {
        world.debts.remove(i);
    }
    let what = RealmEventWhat::Debt { what: DebtWhat::PostReturned, coins: off, owed };
    record_event(world, Some(org), what);
}

/// The Trade Organization goes up to the next of its steps on a debt, as its log says
/// (`debtGoesUp`, ADR 0025). `debt` is its index in `world.debts`.
pub fn debt_goes_up(world: &mut WorldState, debt: usize) {
    let d: &mut Debt = &mut world.debts[debt];
    d.step = Some(DebtStep::Wrecks);
    d.deadline = None;
    let (org, owed) = (d.org.clone(), d.coins);
    record_event(
        world,
        Some(&org),
        RealmEventWhat::Debt { what: DebtWhat::Overdue, coins: 0.0, owed },
    );
}

/// Whether a demand is the Trade Organization's for a debt (`isDebtDemand`).
pub fn is_debt_demand(d: &Demand) -> bool {
    d.from_id == TRADE_ORG && matches!(d.terms, DemandTerms::Goods { .. })
}

/// Whether a demand is the Trade Organization's for a captured post (`isPostDemand`).
pub fn is_post_demand(d: &Demand) -> bool {
    d.from_id == TRADE_ORG && matches!(d.terms, DemandTerms::City { .. })
}

/// A demand of the Trade Organization's declined or lapsed: that starts the next step of its debt
/// (`debtDemandEnded`), unless it has gone further up already, or, for a post, while its demand
/// for the Coins is still open.
fn debt_demand_ended(world: &mut WorldState, d: &Demand) {
    if d.from_id != TRADE_ORG {
        return;
    }
    let Some(i) = world.debts.iter().position(|x| x.org == d.to_id) else { return };
    if world.debts[i].step.is_some_and(|s| s != DebtStep::Demanded) {
        return;
    }
    if is_post_demand(d) && world.demands.iter().any(|x| is_debt_demand(x) && x.to_id == d.to_id) {
        return;
    }
    debt_goes_up(world, i);
}

/// What is set aside on a demand, at `storage` of `owner`, the one who gave in (`setAside`): for a
/// realm to fetch, and for the Trade Organization, its caravans come for it.
fn set_aside(
    world: &mut WorldState,
    d: &Demand,
    owner: &str,
    storage: &Building,
    going: &Stock,
    size: i32,
) {
    let offers = set_aside_for_demand(world, owner, &d.from_id, storage, going);
    if d.from_id != TRADE_ORG {
        return;
    }
    for id in offers {
        let times = world.offers.iter().find(|o| o.id == id).map_or(0.0, |o| o.times);
        order_debt_collection(world, size, owner, &storage.id, times, Some(&id));
    }
}

/// The city a demand names, while it is still the city of the realm the demand was sent to
/// (`cityToHandOver`).
fn city_to_hand_over<'w>(world: &'w WorldState, d: &Demand) -> Option<&'w City> {
    let DemandTerms::City { city_id, .. } = &d.terms else { return None };
    world
        .cities
        .iter()
        .find(|c| &c.id == city_id && c.realm_id.as_deref() == Some(d.to_id.as_str()))
}

/// Why the goods of a demand can't go the way this order names (`goodsProblem`).
fn goods_problem(
    world: &WorldState,
    d: &Demand,
    order: &OrderRequest,
    size: Option<i32>,
) -> Option<String> {
    let how = order.fields.get("handOver");
    if let Some(p) = demand_hand_over_problem(world, &d.to_id, d, how) {
        return Some(p);
    }
    let size = size.filter(|_| d.from_id != TRADE_ORG)?;
    if how.and_then(|h| h.get("way")).and_then(Value::as_str) != Some("transfer") {
        return None;
    }
    let to_city = how.and_then(|h| h.get("toCityId")).and_then(Value::as_str);
    (!sees_storage_of(world, &d.to_id, to_city, size))
        .then(|| "you don’t see that city’s storage".into())
}

fn city_name(world: &WorldState, id: &str) -> String {
    world.cities.iter().find(|c| c.id == id).map(|c| c.name.clone()).unwrap_or_default()
}

/// The goods of an accepted demand change hands the way its receiver named, as far as the storage
/// holds them (`handOverGoods`, `CONTEXT.md`: Demand). What went, for the logs.
fn hand_over_goods(
    world: &mut WorldState,
    d: &Demand,
    goods: &Stock,
    how: &DemandHandOver,
    size: i32,
) -> DemandHandedOver {
    let going = goods_handed_over(world, &d.to_id, goods, how);
    match how {
        DemandHandOver::SetAside { storage_id } => {
            let storage = offer_storage(world, &d.to_id, storage_id).expect("checked").clone();
            set_aside(world, d, &d.to_id, &storage, &going, size);
            DemandHandedOver::SetAside { goods: going, x: storage.x, y: storage.y }
        }
        DemandHandOver::Transfer { from_city_id, .. } if d.from_id == TRADE_ORG => {
            let storage = delivery_storage(world, from_city_id).expect("checked").id.clone();
            let coins = going.get(&Good::Coins).copied().unwrap_or(0.0);
            order_debt_collection(world, size, &d.to_id, &storage, coins, None);
            let to_city = world.transfers.last().map(|t| t.to_city_id.clone()).unwrap_or_default();
            DemandHandedOver::Transfer {
                goods: going,
                from_city: city_name(world, from_city_id),
                to_city: city_name(world, &to_city),
            }
        }
        DemandHandOver::Transfer { from_city_id, to_city_id } => {
            for (good, units) in transfer_loads(&going) {
                order_pick_up(world, size, &d.to_id, from_city_id, to_city_id, good, units);
            }
            DemandHandedOver::Transfer {
                goods: going,
                from_city: city_name(world, from_city_id),
                to_city: city_name(world, to_city_id),
            }
        }
    }
}

/// Accepting a demand (`acceptDemand`, `CONTEXT.md`: Demand): a named city joins the sender's
/// realm at once, as a captured one does. The Trade Organization gets its post back. Goods and
/// Coins go the way the order names; with none of them there it is refused.
pub struct AcceptDemand;

impl OrderKind for AcceptDemand {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        let d = match demand_to_answer(world, sender.user_id, order) {
            Ok(d) => d,
            Err(e) => return Some(e),
        };
        match &d.terms {
            DemandTerms::Goods { .. } => goods_problem(world, &d, order, terrain.map(|t| t.size)),
            DemandTerms::City { city_name, .. } => city_to_hand_over(world, &d)
                .is_none()
                .then(|| format!("{city_name} is no longer yours to hand over")),
        }
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        let Ok(d) = demand_to_answer(world, sender.user_id, order) else { return };
        if let DemandTerms::Goods { goods } = &d.terms {
            // The goods may have gone since the order came, to another demand in this tick too.
            if goods_problem(world, &d, order, terrain.map(|t| t.size)).is_some() {
                return;
            }
            let how = order.fields.get("handOver");
            let Ok(how) = demand_hand_over(world, &d.to_id, &d, how) else { return };
            let size = terrain.map_or(i32::MAX, |t| t.size);
            let handed = hand_over_goods(world, &d, goods, &how, size);
            answered(world, &d, Answer::Accepted, Some(handed));
            return;
        }
        // It may have gone since the order came, to another demand accepted in this tick too.
        let Some(city_id) = city_to_hand_over(world, &d).map(|c| c.id.clone()) else { return };
        let Some(terrain) = terrain else { return };
        if d.from_id == TRADE_ORG {
            post_given_back(world, &d.to_id, &city_id, terrain.size);
        } else {
            hand_over_city(world, &city_id, &d.from_id, terrain.size);
        }
        answered(world, &d, Answer::Accepted, None);
    }
}

/// Declining a demand (`declineDemand`): that is all that happens.
pub struct DeclineDemand;

impl OrderKind for DeclineDemand {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) -> Option<String> {
        demand_to_answer(world, sender.user_id, order).err()
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) {
        if let Ok(d) = demand_to_answer(world, sender.user_id, order) {
            answered(world, &d, Answer::Declined, None);
        }
    }
}

/// A realm's Leader died (`lapseDemandsOnLeaderDeath`, `CONTEXT.md`: Self-managed city): its
/// demands, sent or received, lapse at once. Call it before the realm ends.
pub fn lapse_demands_on_leader_death(world: &mut WorldState, realm_id: &str) {
    let ending: Vec<Demand> = world
        .demands
        .iter()
        .filter(|d| d.from_id == realm_id || d.to_id == realm_id)
        .cloned()
        .collect();
    if ending.is_empty() {
        return;
    }
    world.demands.retain(|d| d.from_id != realm_id && d.to_id != realm_id);
    for d in &ending {
        let side = if d.from_id == realm_id { DemandSide::Sender } else { DemandSide::Receiver };
        let extra = Extra { leader_died: Some(side), handed_over: None };
        tell_both(world, d, DemandWhat::Lapsed, DemandWhat::Lapsed, extra);
    }
}

/// A demand the game answers no: the one it was sent to thinks less of the sender
/// (`gameDeclines`).
fn game_declines(world: &mut WorldState, d: &Demand, loss: f64) {
    change_standing(world, &d.to_id, &d.from_id, -loss);
    answered(world, d, Answer::Declined, None);
}

/// An NPC city gives what a demand won from it (`cityGivesIn`, `CONTEXT.md`: Demand). A city joins
/// at once, and any ask of it to join is forgotten. Goods are set aside for the sender alone to
/// fetch, at its storage that can give the most of them; with none of them there it declines.
fn city_gives_in(world: &mut WorldState, city_id: &str, d: &Demand, size: i32) {
    let goods = match &d.terms {
        DemandTerms::City { .. } => {
            world.join_requests.retain(|q| q.city_id != city_id);
            hand_over_city(world, city_id, &d.from_id, size);
            answered(world, d, Answer::Accepted, None);
            return;
        }
        DemandTerms::Goods { goods } => goods,
    };
    let units = |s: &Stock| s.values().sum::<f64>();
    let city = world.cities.iter().find(|c| c.id == city_id).expect("checked");
    let mut from: Option<(Building, Stock)> = None;
    for storage in npc_storages(world, city) {
        let going =
            goods_to_hand_over(goods, &free_stock(world, &storage.id, storage.stock.as_ref()));
        if from.as_ref().is_none_or(|(_, best)| units(&going) > units(best)) {
            from = Some((storage.clone(), going));
        }
    }
    let Some((storage, going)) = from.filter(|(_, going)| units(going) != 0.0) else {
        game_declines(world, d, DEMAND_DECLINED_STANDING_LOSS);
        return;
    };
    set_aside(world, d, city_id, &storage, &going, size);
    let handed = DemandHandedOver::SetAside { goods: going, x: storage.x, y: storage.y };
    answered(world, d, Answer::Accepted, Some(handed));
}

/// The game's answer to a demand (`answerAsGame`, `CONTEXT.md`: Demand), at the next planning pass
/// of who it was sent to (ADR 0016). The Trade Organization always declines; an NPC city gives in
/// to respect that far outweighs its soldiers, and otherwise declines. A city that is no NPC city
/// any more lapses it.
fn answer_as_game(world: &mut WorldState, d: &Demand, size: i32) {
    let city = world.cities.iter().find(|c| c.id == d.to_id);
    if d.to_id != TRADE_ORG && !city.is_some_and(for_sale) {
        answered(world, d, Answer::Lapsed, None);
        return;
    }
    if !plan_due(world, &d.to_id) {
        return;
    }
    let Some(city) = city else {
        game_declines(world, d, DEMAND_TRADE_ORG_STANDING_LOSS);
        return;
    };
    if yields_to_demand(world, city, &d.from_id, size) {
        let id = city.id.clone();
        city_gives_in(world, &id, d, size);
    } else {
        game_declines(world, d, DEMAND_DECLINED_STANDING_LOSS);
    }
}

/// The game answers the demands sent to what it runs (`answerDemands`). `size` is the map's.
pub fn answer_demands(world: &mut WorldState, size: i32) {
    for d in world.demands.clone() {
        if !world.realms.iter().any(|r| r.id == d.to_id) {
            answer_as_game(world, &d, size);
        }
    }
}

/// Demands lapse at their deadline, as a tick ends, and that is all (`stepDemands`). The Trade
/// Organization carries out what it threatens over a debt (`debtDemandEnded`).
pub fn step_demands(world: &mut WorldState) {
    if world.demands.is_empty() {
        return;
    }
    let tick = world.tick as f64;
    let lapsed: Vec<Demand> =
        world.demands.iter().filter(|d| tick >= d.deadline).cloned().collect();
    if lapsed.is_empty() {
        return;
    }
    world.demands.retain(|d| tick < d.deadline);
    for d in &lapsed {
        tell_both(world, d, DemandWhat::Lapsed, DemandWhat::Lapsed, Extra::default());
        debt_demand_ended(world, d);
    }
}

/// Demands hold together (`demands-sound`, `CONTEXT.md`: Demand).
pub fn demands_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let mut report = |message: String, id: &str| {
        out.push(InvariantViolation {
            invariant: "demands-sound".into(),
            message,
            entity_ids: vec![id.to_string()],
        });
    };
    let tick = world.tick as f64;
    let mut seen = std::collections::HashSet::new();
    for d in &world.demands {
        if !seen.insert(&d.id) {
            report(format!("demand {} is there twice", d.id), &d.id);
        }
        if d.from_id == d.to_id {
            report(format!("demand {} is sent to its own sender", d.id), &d.id);
        }
        let by_game = answered_by_game(world, &d.to_id).is_some();
        let sides: &[&String] = if by_game { &[&d.from_id] } else { &[&d.from_id, &d.to_id] };
        for realm in sides {
            if realm.as_str() != TRADE_ORG && !world.realms.iter().any(|r| &&r.id == realm) {
                report(format!("demand {} has realm {realm}, which does not exist", d.id), &d.id);
            }
        }
        if by_game && tick - d.sent_at > NPC_PLAN_TICKS {
            report(
                format!(
                    "demand {} to {} waited longer than a planning pass for its answer",
                    d.id, d.to_id
                ),
                &d.id,
            );
        }
        if d.deadline <= tick {
            report(
                format!(
                    "open demand {} has deadline {}, not ahead of {}",
                    d.id,
                    crate::realm_pending::js_number(d.deadline),
                    world.tick
                ),
                &d.id,
            );
        }
        if d.deadline <= d.sent_at {
            report(format!("demand {} had no time to be answered", d.id), &d.id);
        }
        let length = d.note.encode_utf16().count() as f64;
        if d.note != js_trim(&d.note) || d.note.is_empty() || length > DEMAND_NOTE_MAX_LENGTH {
            report(format!("demand {} has a note the order wouldn't take", d.id), &d.id);
        }
        if let DemandTerms::Goods { goods } = &d.terms {
            if goods.is_empty() || !goods.values().all(|n| safe_integer(*n) && *n > 0.0) {
                report(format!("demand {} asks for no goods, or not in whole units", d.id), &d.id);
            }
        }
    }
    for r in &world.realms {
        if demands_counted(r, tick).len() as f64 > DEMANDS_PER_GAME_DAY {
            report(
                format!(
                    "realm {} sent more than {DEMANDS_PER_GAME_DAY} demands in a game day",
                    r.id
                ),
                &r.id,
            );
        }
    }
    out
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod answers_tests;

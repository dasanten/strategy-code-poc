//! A Trade Org army buys Food on the way (`trade-org-buying.ts`, `CONTEXT.md`: Trade Org debt).
//! Each soldier packs Coins at the HQ, and one short of Food with Coins left goes to a trading
//! post, NPC city or Player's Food offer near them and buys, by the same trade and accept orders
//! anyone uses (ADR 0002). Their purse and what they buy are their own (`Punishment.members`), so
//! neither counts as taken.

use csp_shared::balance::TRADE_ORG_PUNISH;
use csp_shared::footprint::is_at;
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{
    AcceptOfferOrder, BuildingKind, City, Good, GoodsSpot, PickUpOrder, Punishment, ResidentOrder,
    Stock, TradeOrder, TradeSide, WorldState,
};

use crate::crimes::city_organization;
use crate::queries::city::{for_sale, npc_city_refuses};
use crate::queries::goods::units_that_fit;
use crate::queries::names::{held, held_in, placed};
use crate::queries::offers::{offer_rate, quote_offer};
use crate::queries::standing::TRADE_ORG;
use crate::queries::trade_org::trade_org_refuses;
use crate::queries::trade_quotes::quote_npc_trade;
use crate::queries::warehouse::warehouse_keeps;
use crate::queries::warehouse_trade::{hands_of, owed_by, quote_trade};
use crate::trade_org_punishment::head_for;

fn tile(x: f64, y: f64) -> (i32, i32) {
    (x as i32, y as i32)
}

/// A soldier packing at the HQ takes Coins from its coin warehouse, up to
/// `TRADE_ORG_PUNISH.purse`, as far as they fit and it has them (`packPurse`). What they take for
/// this is their own (member `mi` of punishment `pi`), not what the army came to take. Answers
/// whether they are seeing to it.
pub fn pack_purse(
    world: &mut WorldState,
    hq: &City,
    pi: usize,
    mi: usize,
    ri: usize,
    size: i32,
) -> bool {
    let r = &world.residents[ri];
    let short = (TRADE_ORG_PUNISH.purse - held(&r.carried, Good::Coins).floor())
        .min(units_that_fit(r, Good::Coins, world.tick as f64));
    if short < 1.0 {
        return false;
    }
    let Some(wi) = world.buildings.iter().position(|b| {
        b.city_id.as_deref() == Some(hq.id.as_str())
            && warehouse_keeps(world, b).contains(&Good::Coins)
            && held_in(b.stock.as_ref(), Good::Coins) >= 1.0
    }) else {
        return false;
    };
    let w = &world.buildings[wi];
    if !is_at(tile(r.x, r.y), placed(w), size) {
        let to = (w.x, w.y);
        head_for(world, ri, to);
        return true;
    }
    let coins = short.min(held_in(w.stock.as_ref(), Good::Coins).floor());
    let order = ResidentOrder::PickUp(PickUpOrder {
        from: GoodsSpot::Storage { storage_id: w.id.clone() },
        goods: [(Good::Coins, coins)].into_iter().collect(),
    });
    world.residents[ri].order = Some(order);
    let own = &mut world.punishments[pi].members[mi].own;
    let had = held(own, Good::Coins);
    own.insert(Good::Coins, had + coins);
    true
}

/// A place a soldier could buy Food at, what they would get there, and the order that buys it
/// (`Sale`).
struct Sale {
    place: usize,
    units: f64,
    order: ResidentOrder,
}

/// Whether the army deals with an Organization at all (`dealsWith`): not with the one it is
/// punishing, nor with one the Trade Organization refuses to trade with (`CONTEXT.md`: Trade Org
/// reaction).
fn deals_with(world: &WorldState, p: &Punishment, org: &str) -> bool {
    org != p.culprit_org && !trade_org_refuses(world, org)
}

fn buy_food_order(units: f64) -> ResidentOrder {
    ResidentOrder::Trade(TradeOrder {
        side: TradeSide::Buy,
        good: Good::Food,
        units,
        carriage_id: None,
        city_id: None,
    })
}

/// What a soldier could buy up to `units` of Food for at building `bi` (`saleAt`), if it is a
/// building that sells: a trading post's warehouse, or the storage of an NPC city that doesn't
/// refuse the Trade Organization.
fn sale_at(
    world: &WorldState,
    hq: &City,
    p: &Punishment,
    ri: usize,
    bi: usize,
    units: f64,
) -> Option<Sale> {
    let b = &world.buildings[bi];
    let city = world.cities.iter().find(|c| b.city_id.as_deref() == Some(c.id.as_str()))?;
    let hands = hands_of(&world.residents[ri], world.tick as f64);
    let mut got = 0.0;
    if b.kind == BuildingKind::Warehouse && city.trade_org.is_some() && city.id != hq.id {
        let owed = owed_by(world, &b.id, Good::Food);
        got = quote_trade(world, b, hands, TradeSide::Buy, Good::Food, units, owed).units;
    } else if b.kind == BuildingKind::Storage
        && for_sale(city)
        && city.id != p.city_id
        && deals_with(world, p, city_organization(city))
        && !npc_city_refuses(world, city, TRADE_ORG)
    {
        got = quote_npc_trade(
            world,
            city,
            b,
            hands,
            TradeSide::Buy,
            Good::Food,
            units,
            Some(TRADE_ORG),
        )
        .units;
    }
    (got >= 1.0).then(|| Sale { place: bi, units: got, order: buy_food_order(got) })
}

/// Where a soldier could buy up to `units` of Food within `TRADE_ORG_PUNISH.post_reach` tiles of
/// them (`salesNear`, `sale_at`), and at Players' Food offers for Coins there. A Direct offer is for
/// its named realm alone, and one asking more than `TRADE_ORG_PUNISH.offer_food_price` a unit they
/// pass by.
fn sales_near(
    world: &WorldState,
    hq: &City,
    p: &Punishment,
    ri: usize,
    units: f64,
    size: i32,
) -> Vec<Sale> {
    let reach = TRADE_ORG_PUNISH.post_reach;
    let r = &world.residents[ri];
    let at = tile(r.x, r.y);
    let mut sales = Vec::new();
    for (bi, b) in world.buildings.iter().enumerate() {
        if b.site.is_some()
            || held_in(b.stock.as_ref(), Good::Food) < 1.0
            || wrap_distance(size, at, tile(b.x, b.y)) > reach
        {
            continue;
        }
        if let Some(sale) = sale_at(world, hq, p, ri, bi, units) {
            sales.push(sale);
        }
    }
    let hands = hands_of(r, world.tick as f64);
    for o in &world.offers {
        if o.gives != Good::Food || o.wants != Good::Coins || o.direct.is_some() {
            continue;
        }
        if offer_rate(o) > TRADE_ORG_PUNISH.offer_food_price {
            continue;
        }
        if wrap_distance(size, at, tile(o.x, o.y)) > reach || !deals_with(world, p, &o.realm_id) {
            continue;
        }
        let Some(place) = world.buildings.iter().position(|b| b.id == o.storage_id) else {
            continue;
        };
        let wanted = (units / o.gives_units).ceil();
        let available = held_in(world.buildings[place].stock.as_ref(), Good::Food);
        let q = quote_offer(o, &hands, wanted, available);
        if q.times < 1.0 {
            continue;
        }
        let order = ResidentOrder::AcceptOffer(AcceptOfferOrder {
            offer_id: o.id.clone(),
            times: q.times,
            carriage_id: None,
        });
        sales.push(Sale { place, units: q.gives, order });
    }
    sales
}

/// A soldier (member `mi` of punishment `pi`, resident `ri`) short of `units` of Food with Coins in
/// hand goes to the nearest place selling it (`buyFood`, `sales_near`) and buys. A place they found
/// no way to is out for the rest of the trip. Coins they spend go out of what they brought as they
/// eat (`eatFromOwn`) and the Food is their own at once, as the trade can only come out less than
/// this. Answers whether they are seeing to it.
pub fn buy_food(
    world: &mut WorldState,
    hq: &City,
    pi: usize,
    mi: usize,
    ri: usize,
    units: f64,
    size: i32,
) -> bool {
    let r = &world.residents[ri];
    let sales = if units >= 1.0 && held(&r.carried, Good::Coins) >= 1.0 {
        sales_near(world, hq, &world.punishments[pi], ri, units, size)
    } else {
        Vec::new()
    };
    let member = &world.punishments[pi].members[mi];
    let open: Vec<Sale> = sales
        .into_iter()
        .filter(|s| {
            !member.no_way.as_ref().is_some_and(|w| w.contains(&world.buildings[s.place].id))
        })
        .collect();
    if open.is_empty() {
        world.punishments[pi].members[mi].seller = None;
        return false;
    }
    let at = tile(r.x, r.y);
    let d = |s: &Sale| {
        let b = &world.buildings[s.place];
        wrap_distance(size, at, tile(b.x, b.y))
    };
    // The first of the nearest, as `reduce` keeps.
    let mut best = 0;
    for i in 1..open.len() {
        if d(&open[i]) < d(&open[best]) {
            best = i;
        }
    }
    let sale = open.into_iter().nth(best).expect("one of them");
    let place = &world.buildings[sale.place];
    let place_id = place.id.clone();
    if !is_at(at, placed(place), size) {
        // The walk there ended without them getting there: there is no way.
        let member = &mut world.punishments[pi].members[mi];
        if member.seller.as_deref() == Some(place_id.as_str())
            && world.residents[ri].order.is_none()
        {
            member.no_way.get_or_insert_with(Vec::new).push(place_id);
            member.seller = None;
            return false;
        }
        member.seller = Some(place_id);
        let to = (place.x, place.y);
        head_for(world, ri, to);
        return true;
    }
    world.residents[ri].order = Some(sale.order);
    let member = &mut world.punishments[pi].members[mi];
    member.seller = None;
    let own: &mut Stock = &mut member.own;
    let had = held(own, Good::Food);
    own.insert(Good::Food, had + sale.units);
    true
}

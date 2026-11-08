//! The stock floor (`apps/server/src/stock-floor.ts`, `CONTEXT.md`: Stock floor, ADR 0003,
//! ADR 0023).

use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, Stock, WorldState};

use crate::goods_made::GoodsMade;
use crate::queries::names::held_in;
use crate::queries::trade_org::trade_org_hq;
use crate::queries::warehouse::stock_floor;

/// The stock floor (`stepStockFloor`): at the end of each game day, after food has spoiled, each
/// warehouse of the Trade Org HQ tops up each good it keeps (`stock_floor`) that is below its
/// floor to the floor. A trading post's floor tops up nothing: it only says what its spare hands,
/// caravan and traders go for. The one place goods appear from nothing (noted in `made`); the
/// floor applies to goods, never to people.
pub fn step_stock_floor(world: &mut WorldState, made: &mut GoodsMade) {
    let day = TICKS_PER_GAME_DAY as u64;
    if world.tick % day != day - 1 {
        return;
    }
    let Some(hq) = trade_org_hq(world).map(|c| c.id.clone()) else { return };
    for i in 0..world.buildings.len() {
        let b = &world.buildings[i];
        if b.kind != BuildingKind::Warehouse || b.city_id.as_ref() != Some(&hq) {
            continue;
        }
        let floor = stock_floor(world, b);
        for (good, min) in floor {
            let b = &mut world.buildings[i];
            let have = held_in(b.stock.as_ref(), good);
            if have >= min {
                continue;
            }
            b.stock.get_or_insert_with(Stock::new).insert(good, min);
            made.note(&Stock::from([(good, min - have)]));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use csp_shared::balance::{HQ_FLOOR_FACTOR, WAREHOUSE_FLOOR};
    use csp_shared::world::{Good, TradeOrgCity};

    use crate::test_support::{add_city, building, plains};
    use crate::world::create_world;

    /// The Trade Org HQ's two warehouses, coins and goods, on a small map, with the HQ standing
    /// alone. TODO(T86.9): `foundTradeOrgHq`, as the TypeScript test does.
    fn hq() -> (WorldState, String, String) {
        let mut world = create_world(&plains(128), 1);
        add_city(&mut world, "hq", None, 60.0, 60.0);
        world.cities[0].trade_org = Some(TradeOrgCity::Hq);
        world.cities[0].layout = None;
        // `HQ_COIN_WAREHOUSE` from the town hall.
        let coins = building("coins", BuildingKind::Warehouse, Some("hq"), 64.0, 56.0);
        let goods = building("goods", BuildingKind::Warehouse, Some("hq"), 56.0, 64.0);
        world.buildings.extend([coins, goods]);
        (world, "coins".into(), "goods".into())
    }

    fn stock<'w>(world: &'w WorldState, id: &str) -> &'w Option<Stock> {
        &world.buildings.iter().find(|b| b.id == id).unwrap().stock
    }

    fn set(world: &mut WorldState, id: &str, s: Stock) {
        world.buildings.iter_mut().find(|b| b.id == id).unwrap().stock = Some(s);
    }

    fn floor(world: &WorldState, id: &str) -> Stock {
        stock_floor(world, world.buildings.iter().find(|b| b.id == id).unwrap())
    }

    /// Steps the world to the last tick of the current game day, where the floor tops up.
    fn to_day_end(world: &mut WorldState) {
        let day = TICKS_PER_GAME_DAY as u64;
        world.tick = world.tick / day * day + day - 1;
    }

    #[test]
    fn is_coins_at_the_hq_coin_warehouse_and_the_rest_in_the_other() {
        let (world, coins, goods) = hq();
        let wf = |g: &str| WAREHOUSE_FLOOR.get(g).unwrap();
        assert_eq!(
            floor(&world, &coins),
            Stock::from([(Good::Coins, wf("coins") * HQ_FLOOR_FACTOR)])
        );
        assert_eq!(held_in(Some(&floor(&world, &goods)), Good::Wood), wf("wood") * HQ_FLOOR_FACTOR);
        assert!(!floor(&world, &goods).contains_key(&Good::Coins));
    }

    #[test]
    fn tops_up_what_is_below_the_floor_at_the_hq_once_a_game_day_and_nothing_else() {
        let (mut world, coins, goods) = hq();
        let mut made = GoodsMade::default();
        let f = floor(&world, &goods);
        let stone = f[&Good::Stone] + 500.0;
        set(&mut world, &goods, Stock::from([(Good::Wood, 3.0), (Good::Stone, stone)]));
        set(&mut world, &coins, Stock::from([(Good::Coins, 10.0)]));
        step_stock_floor(&mut world, &mut made);
        assert_eq!(
            *stock(&world, &goods),
            Some(Stock::from([(Good::Wood, 3.0), (Good::Stone, stone)]))
        );
        assert_eq!(*stock(&world, &coins), Some(Stock::from([(Good::Coins, 10.0)])));
        assert_eq!(made.take(), Stock::new());
        to_day_end(&mut world);
        step_stock_floor(&mut world, &mut made);
        let mut want = f.clone();
        want.insert(Good::Stone, stone);
        let got = stock(&world, &goods).clone().unwrap();
        assert_eq!(got.len(), want.len());
        for (g, n) in &want {
            assert_eq!(got[g], *n, "{g:?}");
        }
        assert_eq!(*stock(&world, &coins), Some(floor(&world, &coins)));
        let mut rest = f.clone();
        rest.shift_remove(&Good::Stone);
        rest.insert(Good::Wood, rest[&Good::Wood] - 3.0);
        rest.insert(Good::Coins, floor(&world, &coins)[&Good::Coins] - 10.0);
        let noted = made.take();
        assert_eq!(noted.len(), rest.len());
        for (g, n) in &rest {
            assert_eq!(noted[g], *n, "{g:?}");
        }
    }

    #[test]
    fn tops_up_nothing_at_a_trading_post() {
        let (mut world, _, goods) = hq();
        world.cities[0].trade_org = Some(TradeOrgCity::Post);
        let mut made = GoodsMade::default();
        let s = Stock::from([(Good::Wood, 3.0), (Good::Stone, 500.0), (Good::Coins, 10.0)]);
        set(&mut world, &goods, s.clone());
        to_day_end(&mut world);
        step_stock_floor(&mut world, &mut made);
        assert_eq!(*stock(&world, &goods), Some(s));
        assert_eq!(made.take(), Stock::new());
    }

    #[test]
    fn never_adds_people() {
        let (mut world, _, goods) = hq();
        let mut made = GoodsMade::default();
        set(&mut world, &goods, Stock::new());
        let (residents, horses) = (world.residents.len(), world.horses.len());
        to_day_end(&mut world);
        step_stock_floor(&mut world, &mut made);
        assert_eq!(*stock(&world, &goods), Some(floor(&world, &goods)));
        assert_eq!((world.residents.len(), world.horses.len()), (residents, horses));
    }

    // Not ported here: the warehouse price tests of `stock-floor.test.ts` test `priceFor` and
    // `warehousePrices`, ported with their tests in `queries::warehouse` (T85.5); the trading post
    // floor and `tradeOrgReserve` tests need `foundTradingPost` (T86.9); the `stepWorld` and
    // `goodsOnlyFromNothingAtTheFloor` tests come with the step and the invariants (T86.13,
    // T86.14).
}

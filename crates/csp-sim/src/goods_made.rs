//! Goods that came into the world during the current tick (`apps/server/src/goods-made.ts`), by
//! the rules that may bring them in: work at a workplace, a building torn down or broken giving
//! back some of its materials, and the Trade Org's stock floor (ADR 0003). Kept beside the world,
//! not in it ([`crate::tick::Scratch::made`]): it is only for checking that goods appear nowhere
//! else (`goodsOnlyFromNothingAtTheFloor`).

use csp_shared::world::{Stock, WorldState};

/// The goods noted since the last [`GoodsMade::take`] (`made`, a `WeakMap` beside the world in
/// the TypeScript; scratch here, ADR 0006).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct GoodsMade {
    tally: Stock,
}

impl GoodsMade {
    /// Notes goods that came into the world by work, a teardown, a broken building or the stock
    /// floor (`noteMade`). Only positive amounts count.
    pub fn note(&mut self, goods: &Stock) {
        for (good, &n) in goods {
            if n > 0.0 {
                *self.tally.entry(*good).or_insert(0.0) += n;
            }
        }
    }

    /// The goods noted since the last call, and starts the count again (`takeMade`).
    pub fn take(&mut self) -> Stock {
        std::mem::take(&mut self.tally)
    }
}

/// Every unit of every good in the world (`tallyGoods`): in buildings' storages, delivered to
/// construction sites, carried by residents, loaded on carriages and lying in piles.
pub fn tally_goods(world: &WorldState) -> Stock {
    let mut tally = Stock::new();
    let mut add = |stock: &Stock| {
        for (good, &n) in stock {
            *tally.entry(*good).or_insert(0.0) += n;
        }
    };
    for b in &world.buildings {
        if let Some(stock) = &b.stock {
            add(stock);
        }
        if let Some(site) = &b.site {
            add(&site.delivered);
        }
    }
    for r in &world.residents {
        add(&r.carried);
    }
    for k in &world.carriages {
        add(&k.load);
    }
    for p in &world.piles {
        add(&p.goods);
    }
    tally
}

#[cfg(test)]
mod tests {
    use super::*;
    use csp_shared::world::Good;

    fn stock(entries: &[(Good, f64)]) -> Stock {
        entries.iter().copied().collect()
    }

    #[test]
    fn notes_only_what_came_in_and_takes_it_once() {
        let mut made = GoodsMade::default();
        made.note(&stock(&[(Good::Wood, 2.0), (Good::Stone, 0.0)]));
        made.note(&stock(&[(Good::Wood, 1.0), (Good::Food, -1.0)]));
        assert_eq!(made.take(), stock(&[(Good::Wood, 3.0)]));
        assert_eq!(made.take(), Stock::new());
    }
}

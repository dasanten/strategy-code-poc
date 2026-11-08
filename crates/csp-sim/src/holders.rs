//! Where goods are kept in the world, by position (ADR 0030: no entity holds a reference to
//! another), so rules can move goods between two of them as the TypeScript moves between two
//! stock objects.

use csp_shared::world::{Good, Stock, WorldState};

use crate::queries::goods::move_goods;

/// Where a stock is kept: a pile's goods, a building's stock, a site's delivered materials, a
/// carriage's load or what a resident carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Holder {
    Pile(usize),
    Storage(usize),
    Site(usize),
    Carriage(usize),
    Resident(usize),
}

/// The stock a holder keeps, to change. A building without a stock gets an empty one
/// (`b.stock ??= {}`).
pub fn stock_mut(world: &mut WorldState, h: Holder) -> &mut Stock {
    match h {
        Holder::Pile(i) => &mut world.piles[i].goods,
        Holder::Storage(i) => world.buildings[i].stock.get_or_insert_with(Stock::new),
        Holder::Site(i) => &mut world.buildings[i].site.as_mut().expect("a site").delivered,
        Holder::Carriage(i) => &mut world.carriages[i].load,
        Holder::Resident(i) => &mut world.residents[i].carried,
    }
}

/// A copy of the stock a holder keeps; empty for a building without one.
pub fn stock_of(world: &WorldState, h: Holder) -> Stock {
    match h {
        Holder::Pile(i) => world.piles[i].goods.clone(),
        Holder::Storage(i) => world.buildings[i].stock.clone().unwrap_or_default(),
        Holder::Site(i) => world.buildings[i].site.as_ref().expect("a site").delivered.clone(),
        Holder::Carriage(i) => world.carriages[i].load.clone(),
        Holder::Resident(i) => world.residents[i].carried.clone(),
    }
}

/// Moves units of a good between two holders (`move`): nothing for `units <= 0`, nor between a
/// holder and itself, where the TypeScript's move takes out and puts back the same units.
pub fn move_between(world: &mut WorldState, from: Holder, to: Holder, good: Good, units: f64) {
    if units <= 0.0 || from == to {
        return;
    }
    let mut source = std::mem::take(stock_mut(world, from));
    let mut target = std::mem::take(stock_mut(world, to));
    move_goods(&mut source, &mut target, good, units);
    *stock_mut(world, from) = source;
    *stock_mut(world, to) = target;
}

/// The goods of several holders added up, each holder once (`total([...new Set(parties)])`).
pub fn total(world: &WorldState, holders: &[Holder]) -> Stock {
    let mut seen: Vec<Holder> = Vec::new();
    let mut sum = Stock::new();
    for &h in holders {
        if seen.contains(&h) {
            continue;
        }
        seen.push(h);
        for (g, n) in stock_of(world, h) {
            *sum.entry(g).or_insert(0.0) += n;
        }
    }
    sum
}

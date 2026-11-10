//! `apps/server/src/offers.test.ts`'s slow simulation (#1038): a pick-up from a storage with an
//! offer standing at it, from `setup()` of `deliveries.fixture.ts`
//! (`fixtures/trade/deliveries.json`). The file's other cases are `src/offers/tests.rs`.

mod common;
#[path = "goods_support/mod.rs"]
mod goods_support;
mod transfers_fixture;

use csp_shared::world::{Good, Offer, Stock};
use csp_sim::walking::Walking;
use csp_sim::world::step_world;
use serde_json::json;
use transfers_fixture::{deliveries, MARA};

#[test]
#[ignore = "17.9 s alone; see #1092"]
fn a_caravan_collecting_a_pick_up_leaves_them_alone_and_no_theft_comes_of_it() {
    let mut s = deliveries();
    let (storage, city, realm) = (s.storage.clone(), s.city.clone(), s.realm.clone());
    s.b_mut(&storage).stock = Some(Stock::from([(Good::Stone, 40.0)]));
    let (x, y) = s.xy(&storage);
    s.world.offers.push(Offer {
        id: "o1".into(),
        realm_id: realm,
        storage_id: storage.clone(),
        x,
        y,
        gives: Good::Stone,
        gives_units: 10.0,
        wants: Good::Coins,
        wants_units: 1.0,
        times: 1.0,
        direct: None,
    });
    let sale = json!({ "kind": "sell", "good": "stone", "units": 40, "cityId": city });
    assert_eq!(s.order(sale), "ack");
    let terrain = s.terrain.clone();
    let mut walking = Walking::new(terrain.clone());
    // The first tick orders the pick-up; then the caravan comes for it.
    let mut i = 0;
    while i < 20_000 && (i == 0 || !s.world.deliveries.is_empty()) {
        for r in &mut s.world.residents {
            r.hunger = 100.0;
        }
        step_world(&mut s.world, &terrain, &mut s.scratch, Some(&mut walking), None);
        i += 1;
    }
    assert_eq!(s.world.deliveries, vec![]);
    assert_eq!(s.events("delivered", MARA).len(), 1);
    assert_eq!(s.held(&storage, Good::Stone), Some(10.0));
    assert_eq!(s.world.offers[0].times, 1.0);
    assert_eq!(s.world.crimes, vec![]);
    assert_eq!(s.broken(), Vec::<String>::new());
}

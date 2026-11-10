//! `apps/server/src/caravan-theft.test.ts`: so far only its slow simulation (#1038), from
//! `setup()` of `deliveries.fixture.ts` (`fixtures/trade/deliveries.json`). The file's other cases
//! are not ported yet.

mod common;
#[path = "goods_support/mod.rs"]
mod goods_support;
mod transfers_fixture;

use csp_shared::world::{CaravanJobStep, CaravanStop, Good, Heading, WorldState};
use csp_sim::queries::carriages::crew_ids_of;
use csp_sim::survival::die;
use serde_json::json;
use transfers_fixture::{deliveries, Fixture};

/// Stands the caravan's carriage, its hitched horse and its crew on tile (x, y) (`put`).
fn put(s: &mut Fixture, x: f64, y: f64) {
    let c = s.world.caravans[0].clone();
    let k = s.world.carriages.iter_mut().find(|k| k.id == c.carriage_id).unwrap();
    k.x = x;
    k.y = y;
    let horse = k.horse_id.clone();
    if let Some(h) = s.world.horses.iter_mut().find(|h| Some(&h.id) == horse.as_ref()) {
        h.x = x;
        h.y = y;
    }
    for id in crew_ids_of(c.driver_id.as_deref(), &c.escort_ids) {
        let r = s.world.residents.iter_mut().find(|r| r.id == id).unwrap();
        r.x = x;
        r.y = y;
        // Whatever way they were on leads from where they stood.
        r.order = None;
    }
}

/// The caravan standing at the post's warehouse, to take on what waits there (`atWarehouse`).
fn at_warehouse(s: &mut Fixture) {
    let (x, y) = (s.warehouse().x, s.warehouse().y);
    put(s, x, y);
    let c = &mut s.world.caravans[0];
    c.heading = Heading::Post;
    c.stop = CaravanStop::Warehouse;
    c.to_load = None;
}

fn step_is(w: &WorldState, step: CaravanJobStep) -> bool {
    w.caravans[0].job.as_ref().is_some_and(|j| j.step == step)
}

mod stealing_a_caravans_carriage {
    use super::*;

    #[test]
    #[ignore = "57.0 s alone; see #1092"]
    fn gets_a_deliverys_goods_to_the_city_after_all() {
        let mut s = deliveries();
        let city = s.city.clone();
        let o = json!({ "kind": "buy", "good": "iron", "units": 6, "cityId": city });
        assert_eq!(s.order(o), "ack");
        s.run_until(5, |w| !w.deliveries.is_empty());
        at_warehouse(&mut s);
        s.run_until(200, |w| step_is(w, CaravanJobStep::Deliver));
        let before = s.held(&s.storage, Good::Iron).unwrap_or(0.0);
        let c = s.world.caravans[0].clone();
        let stolen = s.world.carriages.iter().find(|k| k.id == c.carriage_id).unwrap().clone();
        let p1 = s.world.residents.iter_mut().find(|r| r.id == "p1").unwrap();
        p1.x = stolen.x;
        p1.y = stolen.y;
        for id in crew_ids_of(c.driver_id.as_deref(), &c.escort_ids) {
            die(&mut s.world, &id);
        }
        let taken =
            json!({ "kind": "drive", "carriageId": stolen.id, "x": stolen.x + 5.0, "y": stolen.y });
        assert_eq!(s.order(taken), "ack");
        s.run_until(20_000, |w| w.deliveries.is_empty());
        assert_eq!(s.held(&s.storage, Good::Iron), Some(before + 6.0));
        assert_eq!(s.world.route_robberies.get(&c.post_id), Some(&1.0));
        assert_eq!(s.world.route_robberies.len(), 1);
    }
}

//! `mountain-roads.test.ts`: carriages and riders cross Mountain on a finished road
//! (`CONTEXT.md`: Road, Step, Carriage, Riding), and only there.

use std::sync::Arc;

use csp_shared::balance::{AVERAGE_HORSE_STATS, MAX_HEALTH, MAX_HUNGER};
use csp_shared::terrain::{terrain_at, Terrain, TerrainMap};
use csp_shared::world::{Building, Carriage, Good, Horse, Realm, ResidentOrder, Stock, WorldState};
use serde_json::{json, Value};

use crate::invariants::check_all;
use crate::order_sender::OrderSender;
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::queries::building::teardown_work;
use crate::random::Mulberry32;
use crate::residents::{new_resident, NewResident};
use crate::survival::drop_goods;
use crate::tick::Scratch;
use crate::walking::Walking;
use crate::world::{create_world, step_world};

/// A square map drawn as text (sides join): . plains, ^ mountain (`draw`).
fn draw(rows: &[String]) -> TerrainMap {
    let tiles = rows
        .concat()
        .chars()
        .map(|c| if c == '^' { Terrain::Mountain as u8 } else { Terrain::Plains as u8 })
        .collect();
    TerrainMap { size: rows.len() as i32, tiles }
}

/// Ridges of Mountain right across the map at y = 6 and y = 13, with no pass: the sides join, so
/// between them lies a closed strip.
fn ridge() -> TerrainMap {
    let rows: Vec<String> =
        (0..16).map(|y| if y == 6 || y == 13 { "^" } else { "." }.repeat(16)).collect();
    draw(&rows)
}

/// The ridge at y = 6 with a pass at x = 12.
fn with_pass() -> TerrainMap {
    let rows: Vec<String> = (0..16)
        .map(|y| match y {
            6 => format!("{}.{}", "^".repeat(12), "^".repeat(3)),
            13 => "^".repeat(16),
            _ => ".".repeat(16),
        })
        .collect();
    draw(&rows)
}

fn me() -> OrderSender {
    OrderSender::player(7, "Mara")
}

fn new_w(id: &str, seed: f64, x: f64, y: f64) -> csp_shared::world::Resident {
    let mut m = Mulberry32::new(seed);
    let fields = NewResident { id, owner: Some("r1"), city_id: None, x, y, tick: 0.0 };
    new_resident(&mut || m.next(), &fields, None)
}

/// A world on `map` with realm r1 (Player 7, Leader w1) and, at (x, y), w1, carriage k1 of r1
/// and horse h1 of r1, not yet hitched (`setup`).
struct Setup {
    world: WorldState,
    map: Arc<TerrainMap>,
    scratch: Scratch,
    walking: Walking,
}

fn setup(map: TerrainMap, x: f64, y: f64) -> Setup {
    let mut world = create_world(&map, 1);
    world.nodes.clear();
    let realm = json!({ "id": "r1", "userId": 7, "leaderId": "w1" });
    world.realms.push(serde_json::from_value::<Realm>(realm).unwrap());
    world.residents.push(new_w("w1", 1.0, x, y));
    let s = AVERAGE_HORSE_STATS;
    let horse = json!({
        "id": "h1", "realmId": "r1", "cityId": null, "x": x, "y": y, "hunger": MAX_HUNGER,
        "health": MAX_HEALTH, "name": "Rowan",
        "stats": { "speed": s.speed, "strength": s.strength, "endurance": s.endurance }, "bornAt": 0,
    });
    world.horses.push(serde_json::from_value::<Horse>(horse).unwrap());
    let k = Carriage {
        id: "k1".into(),
        realm_id: Some("r1".into()),
        city_id: None,
        x,
        y,
        horse_id: None,
        load: Stock::new(),
    };
    world.carriages.push(k);
    let map = Arc::new(map);
    Setup { world, walking: Walking::new(map.clone()), map, scratch: Scratch::default() }
}

fn set_order(o: Value) -> Option<ResidentOrder> {
    Some(serde_json::from_value(o).unwrap())
}

fn drive_to(x: i32, y: i32) -> Option<ResidentOrder> {
    let o = json!({ "kind": "drive", "carriageId": "k1", "target": { "x": x, "y": y }, "path": null, "progress": 0 });
    set_order(o)
}

impl Setup {
    /// A finished road on (x, y), or a road site with `site` (`road`); its id.
    fn road(&mut self, x: i32, y: i32, site: bool) -> String {
        let id = format!("road-{x}-{y}");
        let mut b = json!({ "id": id, "kind": "road", "cityId": null, "x": x, "y": y });
        if site {
            b["site"] = json!({ "delivered": {}, "work": 0 });
        }
        self.world.buildings.push(serde_json::from_value::<Building>(b).unwrap());
        id
    }

    /// Receives an order, without applying it: `ack`, or why it was turned down (`order`).
    fn order(&self, o: Value) -> String {
        let mut q = OrderQueue::new(order_kinds(), Some(self.map.clone()));
        reply(q.receive(&self.world, &me(), &json!("q"), &o))
    }

    fn step(&mut self) {
        step_world(&mut self.world, &self.map, &mut self.scratch, Some(&mut self.walking), None);
    }

    fn r(&mut self, id: &str) -> &mut csp_shared::world::Resident {
        self.world.residents.iter_mut().find(|r| r.id == id).unwrap()
    }

    fn w1(&self) -> &csp_shared::world::Resident {
        self.world.residents.iter().find(|r| r.id == "w1").unwrap()
    }

    fn carriage(&mut self) -> &mut Carriage {
        &mut self.world.carriages[0]
    }

    fn carriage_at(&self) -> (f64, f64) {
        (self.world.carriages[0].x, self.world.carriages[0].y)
    }

    fn building(&self, id: &str) -> Option<&Building> {
        self.world.buildings.iter().find(|b| b.id == id)
    }

    /// Steps the world until w1's order is done or `max` ticks pass, checking the invariants every
    /// tick; returns every tile w1 stood on (`run`).
    fn run(&mut self, max: usize) -> Vec<(f64, f64)> {
        let mut tiles = vec![(self.w1().x, self.w1().y)];
        for _ in 0..max {
            if self.w1().order.is_none() {
                break;
            }
            self.step();
            assert_eq!(check_all(&self.world, &self.map), []);
            let here = (self.w1().x, self.w1().y);
            if *tiles.last().unwrap() != here {
                tiles.push(here);
            }
        }
        tiles
    }

    fn names(&self) -> Vec<String> {
        check_all(&self.world, &self.map).into_iter().map(|v| v.invariant).collect()
    }
}

fn reply(r: OrderReply) -> String {
    match r {
        OrderReply::Ack { .. } => "ack".into(),
        OrderReply::Rejected { reason, .. } => reason,
    }
}

fn on_mountain(map: &TerrainMap, tiles: &[(f64, f64)]) -> bool {
    tiles.iter().any(|&(x, y)| terrain_at(map, x as i32, y as i32) == Terrain::Mountain as u8)
}

const CANT_GO: &str = "a carriage can\u{2019}t go there";

// a carriage on a mountain road

#[test]
fn may_be_driven_to_a_road_over_mountain_not_to_bare_mountain_or_a_road_site_there() {
    let mut s = setup(ridge(), 2.0, 2.0);
    s.road(2, 6, false);
    s.road(5, 6, true);
    let drive = |s: &Setup, x: i32| {
        s.order(json!({ "kind": "drive", "residentId": "w1", "carriageId": "k1", "x": x, "y": 6 }))
    };
    assert_eq!(drive(&s, 2), "ack");
    assert_eq!(drive(&s, 3), CANT_GO);
    assert_eq!(drive(&s, 5), CANT_GO);
}

#[test]
fn finds_and_drives_a_way_over_the_road_without_it_there_is_no_way() {
    let mut s = setup(ridge(), 2.0, 2.0);
    s.r("w1").order = drive_to(2, 10);
    s.run(20_000);
    assert_eq!(s.carriage_at(), (2.0, 2.0));

    let mut crossing = setup(ridge(), 2.0, 2.0);
    crossing.road(9, 6, false);
    crossing.r("w1").order = drive_to(2, 10);
    let tiles = crossing.run(20_000);
    assert_eq!(crossing.carriage_at(), (2.0, 10.0));
    // Over the ridge only by the road.
    let over: Vec<_> = tiles.into_iter().filter(|&(_, y)| y == 6.0).collect();
    assert_eq!(over, [(9.0, 6.0)]);
}

#[test]
fn goes_round_to_a_pass_when_that_is_the_only_way_never_onto_bare_mountain() {
    // A pass at x = 12 and a road at x = 9; drive with the road gone and it takes the pass.
    let mut s = setup(with_pass(), 9.0, 2.0);
    s.r("w1").order = drive_to(9, 10);
    let tiles = s.run(20_000);
    assert_eq!(s.carriage_at(), (9.0, 10.0));
    assert!(!on_mountain(&s.map, &tiles));
}

#[test]
fn takes_a_mountain_road_over_a_longer_way_round_by_a_pass() {
    // A pass at x = 12 and a road at x = 2: straight down the road is 8 tiles, round by the pass
    // about 15. Carriage and rider both cross by the road.
    let over = |tiles: Vec<(f64, f64)>| -> Vec<(f64, f64)> {
        tiles.into_iter().filter(|&(_, y)| y == 6.0).collect()
    };
    let mut driving = setup(with_pass(), 2.0, 2.0);
    driving.road(2, 6, false);
    driving.r("w1").order = drive_to(2, 10);
    let tiles = driving.run(20_000);
    assert_eq!(driving.carriage_at(), (2.0, 10.0));
    assert_eq!(over(tiles), [(2.0, 6.0)]);

    let mut riding = setup(with_pass(), 2.0, 2.0);
    riding.world.carriages.clear();
    riding.r("w1").riding = Some("h1".into());
    riding.road(2, 6, false);
    riding.r("w1").order = set_order(
        json!({ "kind": "walkTo", "target": { "x": 2, "y": 10 }, "path": null, "progress": 0 }),
    );
    let tiles = riding.run(20_000);
    assert_eq!((riding.w1().x, riding.w1().y), (2.0, 10.0));
    assert_eq!(riding.w1().riding.as_deref(), Some("h1"));
    assert_eq!(over(tiles), [(2.0, 6.0)]);
}

#[test]
fn hauls_over_the_road_context_md_haul_route() {
    let mut s = setup(ridge(), 2.0, 2.0);
    s.road(2, 6, false);
    let size = s.map.size;
    drop_goods(&mut s.world, 2.0, 2.0, &Stock::from([(Good::IronOre, 20.0)]), size);
    let haul = |y: i32| json!({ "kind": "haul", "residentId": "w1", "carriageId": "k1", "x": 2, "y": y, "goods": ["ironOre"], "keepFood": 0 });
    assert_eq!(s.order(haul(13)), CANT_GO);
    assert_eq!(s.order(haul(6)), "ack");
    let mut q = OrderQueue::new(order_kinds(), Some(s.map.clone()));
    assert_eq!(reply(q.receive(&s.world, &me(), &json!("q"), &haul(10))), "ack");
    q.apply_all(&mut s.world);
    let kind = serde_json::to_value(s.w1().order.as_ref().unwrap()).unwrap()["kind"].clone();
    assert_eq!(kind, "haul");
    for _ in 0..20_000 {
        if s.carriage_at().1 == 10.0 {
            break;
        }
        s.step();
        assert_eq!(check_all(&s.world, &s.map), []);
        if s.carriage_at().1 == 6.0 {
            assert_eq!(s.carriage_at().0, 2.0);
        }
    }
    assert_eq!(s.carriage_at(), (2.0, 10.0));
}

#[test]
fn steps_diagonally_past_a_mountain_road_but_not_past_bare_mountain() {
    // From (2, 2) to (3, 3) with Mountain on (3, 2), plains on (2, 3).
    let mut rows: Vec<String> = (0..16).map(|_| ".".repeat(16)).collect();
    rows[2] = format!("...^{}", ".".repeat(12));
    let map = draw(&rows);
    let steps = |with_road: bool| {
        let mut s = setup(map.clone(), 2.0, 2.0);
        if with_road {
            s.road(3, 2, false);
        }
        s.r("w1").order = drive_to(3, 3);
        s.run(20_000)[1..].to_vec()
    };
    assert_eq!(steps(true), [(3.0, 3.0)]);
    assert_eq!(steps(false), [(2.0, 3.0), (3.0, 3.0)]);
}

#[test]
fn finds_a_new_way_when_the_road_under_its_path_is_gone() {
    let mut s = setup(with_pass(), 9.0, 2.0);
    let b = s.road(9, 6, false);
    s.r("w1").order = drive_to(9, 10);
    while s.carriage_at().1 < 4.0 {
        s.step();
    }
    s.world.buildings.retain(|x| x.id != b);
    let tiles = s.run(20_000);
    assert_eq!(s.carriage_at(), (9.0, 10.0));
    assert!(!on_mountain(&s.map, &tiles));
}

// a rider on a mountain road

#[test]
fn crosses_the_ridge_by_the_road_and_may_be_sent_onto_it_but_not_onto_bare_mountain() {
    let mut s = setup(ridge(), 2.0, 2.0);
    s.world.carriages.clear();
    s.r("w1").riding = Some("h1".into());
    s.road(7, 6, false);
    let walk_to = |s: &Setup, x: i32, y: i32| {
        s.order(json!({ "kind": "walkTo", "residentId": "w1", "x": x, "y": y }))
    };
    assert_eq!(walk_to(&s, 7, 6), "ack");
    assert_eq!(walk_to(&s, 2, 6), "a horse can\u{2019}t go there");
    s.r("w1").order = set_order(
        json!({ "kind": "walkTo", "target": { "x": 2, "y": 10 }, "path": null, "progress": 0 }),
    );
    let tiles = s.run(20_000);
    let h = &s.world.horses[0];
    assert_eq!((s.w1().x, s.w1().y, h.x, h.y), (2.0, 10.0, 2.0, 10.0));
    assert_eq!(s.w1().riding.as_deref(), Some("h1"));
    let over: Vec<_> = tiles.into_iter().filter(|&(_, y)| y == 6.0).collect();
    assert_eq!(over, [(7.0, 6.0)]);
}

// tearing down a mountain road

#[test]
fn waits_for_the_carriages_and_ridden_horses_on_it_to_leave() {
    let mut s = setup(ridge(), 4.0, 6.0);
    s.world.residents.push(new_w("w2", 2.0, 4.0, 6.0));
    let b = s.road(4, 6, false);
    let tear_down = |s: &Setup, id: &str| {
        s.order(json!({ "kind": "tearDown", "residentId": "w1", "buildingId": id }))
    };
    let stranded = "a carriage or rider on this mountain road would be stranded";
    assert_eq!(tear_down(&s, &b), stranded);
    // A horse nobody rides doesn't hold it up; a ridden one does.
    s.carriage().y = 5.0;
    assert_eq!(tear_down(&s, &b), "ack");
    s.r("w2").riding = Some("h1".into());
    assert_eq!(tear_down(&s, &b), stranded);
    s.r("w2").riding = None;

    // Started with nobody there; a rider gets on before the work is done, and the work waits for
    // them to get off or leave.
    s.r("w1").order =
        set_order(json!({ "kind": "tearDown", "buildingId": b, "at": { "x": 4, "y": 6 } }));
    s.step();
    let done = s.building(&b).unwrap().teardown.expect("work begun");
    assert!(done > 0.0);
    s.r("w2").riding = Some("h1".into());
    for _ in 0..100 {
        s.step();
    }
    assert_eq!(s.building(&b).unwrap().teardown, Some(done));
    let kind = serde_json::to_value(s.w1().order.as_ref().unwrap()).unwrap()["kind"].clone();
    assert_eq!(kind, "tearDown");
    assert_eq!(check_all(&s.world, &s.map), []);
    s.r("w2").riding = None;
    let road = s.building(&b).unwrap().clone();
    for _ in 0..20_000 {
        if s.w1().order.is_none() {
            break;
        }
        s.step();
    }
    assert!(s.building(&b).is_none());
    assert!(teardown_work(&road) > done);

    // The horse left behind on bare Mountain can't be ridden there.
    let mount = s.order(json!({ "kind": "mount", "residentId": "w2", "horseId": "h1" }));
    assert_eq!(mount, "a horse can\u{2019}t be ridden on Mountain without a road");
    assert_eq!(check_all(&s.world, &s.map), []);

    // A road on plains comes down whoever stands on it.
    let plains = s.road(4, 5, false);
    assert_eq!(tear_down(&s, &plains), "the resident is not at that building");
    s.r("w1").y = 5.0;
    assert_eq!(tear_down(&s, &plains), "ack");
}

// the invariants (ADR 0004)

#[test]
fn flag_a_carriage_or_ridden_horse_on_mountain_without_a_finished_road() {
    let mut s = setup(ridge(), 4.0, 6.0);
    s.carriage().horse_id = None;
    assert!(s.names().contains(&"carriages-in-place".to_string()));
    s.road(4, 6, true);
    assert!(s.names().contains(&"carriages-in-place".to_string()));
    s.world.buildings[0].site = None;
    assert_eq!(s.names(), Vec::<String>::new());

    s.world.buildings.clear();
    s.world.carriages.clear();
    s.r("w1").riding = Some("h1".into());
    assert!(s.names().contains(&"riders-on-horses".to_string()));
    s.road(4, 6, false);
    assert_eq!(s.names(), Vec::<String>::new());
}

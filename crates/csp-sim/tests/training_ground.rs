//! `apps/server/src/training-ground.test.ts`, ported one to one.

use std::sync::Arc;

use csp_shared::balance::{BUILD_MATERIALS, BUILD_WORK, RECIPES, WORKPLACE_MAX_WORKERS};
use csp_shared::footprint::FOOTPRINT;
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{Building, BuildingKind, Good, Stat, Stock, WorldState};
use serde_json::{json, Value};

use csp_sim::invariants::check_all;
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::{order_kinds, OrderQueue, OrderReply};
use csp_sim::queries::building::{
    build_menu, teardown_returns, teardown_work, BUILDABLE, OFF_NODES,
};
use csp_sim::queries::goods::pile_at;
use csp_sim::random::Mulberry32;
use csp_sim::residents::{new_resident, NewResident};
use csp_sim::tick::Scratch;
use csp_sim::world::{create_world, step_world};

/// Plains, with Mountain at (12, 12) (`map`).
fn map() -> TerrainMap {
    let mut tiles = vec![Terrain::Plains as u8; 16 * 16];
    tiles[12 * 16 + 12] = Terrain::Mountain as u8;
    TerrainMap { size: 16, tiles }
}

fn me() -> OrderSender {
    OrderSender::player(7, "Mara")
}

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    queue: OrderQueue,
}

/// A world with realm r1 (Player 7) and resident w1 standing on (x, y), Strength 10 (`setup`).
fn setup(x: f64, y: f64) -> Setup {
    let terrain = map();
    let plains = TerrainMap { size: 16, tiles: vec![Terrain::Plains as u8; 16 * 16] };
    let mut world = create_world(&plains, 1);
    world.realms.push(
        serde_json::from_value(json!({ "id": "r1", "userId": 7, "leaderId": "w1" })).unwrap(),
    );
    let mut m = Mulberry32::new(1.0);
    let fields = NewResident { id: "w1", owner: Some("r1"), city_id: None, x, y, tick: 0.0 };
    let mut r = new_resident(&mut || m.next(), &fields, None);
    r.stats.strength = Stat { base: 10.0, trained: 0.0 };
    r.stats.intellect = Stat { base: 10.0, trained: 0.0 };
    world.residents.push(r);
    let queue = OrderQueue::new(order_kinds(), Some(Arc::new(terrain.clone())));
    Setup { world, terrain, queue }
}

impl Setup {
    /// Sends an order and, if accepted, applies it; answers "ack" or why it was rejected
    /// (`order`).
    fn order(&mut self, o: Value) -> String {
        let answer = self.queue.receive(&self.world, &me(), &json!("q"), &o);
        self.queue.apply_all(&mut self.world);
        match answer {
            OrderReply::Ack { .. } => "ack".into(),
            OrderReply::Rejected { reason, .. } => reason,
        }
    }

    /// Steps the world, keeping residents fed (`run`).
    fn run(&mut self) {
        for r in &mut self.world.residents {
            r.hunger = 100.0;
        }
        step_world(&mut self.world, &self.terrain, &mut Scratch::default(), None, None);
    }
}

fn build() -> Value {
    json!({ "kind": "build", "residentId": "w1", "building": "trainingGround" })
}

fn ground() -> Building {
    serde_json::from_value(json!({
        "id": "g1", "kind": "trainingGround", "cityId": null, "x": 3, "y": 3,
    }))
    .unwrap()
}

// the training ground (`CONTEXT.md`: Training ground)

#[test]
fn is_a_3x3_building_anyone_can_build_off_nodes_and_mountain_from_wood_and_stone() {
    assert_eq!(FOOTPRINT.get("trainingGround"), Some(3));
    assert!(BUILDABLE.contains(&BuildingKind::TrainingGround));
    assert!(OFF_NODES.contains(&BuildingKind::TrainingGround));
    assert!(build_menu(None).contains(&BuildingKind::TrainingGround));
    let materials = BUILD_MATERIALS.get("trainingGround").unwrap();
    let keys: Vec<&str> = materials.0.iter().map(|(k, _)| *k).collect();
    assert_eq!(keys, ["wood", "stone"]);
    assert!(materials.get("wood").unwrap() > materials.get("stone").unwrap());
    assert!(BUILD_WORK.get("trainingGround").unwrap() > 0.0);
}

#[test]
fn is_no_workplace_no_workers_no_recipe_and_nobody_can_work_it() {
    assert_eq!(WORKPLACE_MAX_WORKERS.get("trainingGround"), None);
    assert!(RECIPES.get("trainingGround").is_none());
    let mut s = setup(3.0, 3.0);
    s.world.buildings.push(ground());
    assert_eq!(
        s.order(json!({ "kind": "workAt", "residentId": "w1" })),
        "there is no workplace to work here"
    );
}

#[test]
fn is_laid_out_built_from_its_delivered_materials_and_finished_like_any_building_of_no_city() {
    let mut s = setup(3.0, 3.0);
    assert_eq!(s.order(build()), "ack");
    s.run();
    let i = s.world.buildings.iter().position(|b| b.site.is_some()).unwrap();
    let site = &s.world.buildings[i];
    assert_eq!(site.kind, BuildingKind::TrainingGround);
    assert_eq!(
        (site.city_id.as_deref(), site.realm_id.as_deref(), site.x, site.y),
        (None, Some("r1"), 3.0, 3.0)
    );
    assert_eq!(check_all(&s.world, &s.terrain), vec![]);
    // With its materials there and nearly all the work in, one more tick finishes it.
    let materials: Stock = BUILD_MATERIALS
        .get("trainingGround")
        .unwrap()
        .0
        .iter()
        .map(|(g, n)| (serde_json::from_value::<Good>(json!(g)).unwrap(), *n))
        .collect();
    let id = s.world.buildings[i].id.clone();
    let work = s.world.buildings[i].site.as_mut().unwrap();
    work.delivered = materials;
    work.work = BUILD_WORK.get("trainingGround").unwrap() - 0.5;
    s.run();
    let site = &s.world.buildings[i];
    assert!(site.site.is_none());
    assert!(site.realm_id.is_none());
    let want: Building = serde_json::from_value(json!({
        "id": id, "kind": "trainingGround", "cityId": null, "x": 3, "y": 3,
    }))
    .unwrap();
    assert_eq!(s.world.buildings, [want]);
    assert_eq!(s.world.residents[0].order, None);
    assert_eq!(check_all(&s.world, &s.terrain), vec![]);
}

#[test]
fn refuses_mountain_under_any_tile_of_its_footprint() {
    // From (10, 10) the footprint reaches (12, 12), the Mountain; from (9, 9) it stops short.
    let mut s = setup(10.0, 10.0);
    assert_eq!(
        s.order(build()),
        "a trainingGround goes off any resource node, and not on Mountain"
    );
    assert!(s.world.buildings.is_empty());
    let mut ok = setup(9.0, 9.0);
    assert_eq!(ok.order(build()), "ack");
}

#[test]
fn is_torn_down_like_any_building_leaving_part_of_its_materials_on_the_tile() {
    let mut s = setup(3.0, 3.0);
    s.world.buildings.push(ground());
    assert_eq!(
        s.order(json!({ "kind": "tearDown", "residentId": "w1", "buildingId": "g1" })),
        "ack"
    );
    let left = teardown_returns(&ground());
    assert!(left.get(&Good::Wood).copied().unwrap_or(0.0) > 0.0);
    // Almost torn down already: one tick of work finishes it.
    s.world.buildings[0].teardown = Some(teardown_work(&ground()) - 0.5);
    s.run();
    assert!(s.world.buildings.is_empty());
    assert_eq!(pile_at(&s.world, 3.0, 3.0).map(|p| p.goods.clone()), Some(left));
    assert_eq!(s.world.residents[0].order, None);
    assert_eq!(check_all(&s.world, &s.terrain), vec![]);
}

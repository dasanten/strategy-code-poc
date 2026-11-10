//! `npc-far-nodes.test.ts`'s slow simulations (#1038): an NPC city building on a far node its
//! scouts found. The file's other cases are not ported yet.

use csp_shared::balance::{
    CREW_FOOD, NPC_NODE_REACH, NPC_SURPLUS_CAP, NPC_TOWN,
};
use csp_shared::terrain::{tile_index, wrap_distance, Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{Building, BuildingKind, Good, ResourceKind, ResourceNode, WorldState};
use serde_json::{json, Value};

use crate::invariants::check_all;
use crate::queries::building::build_materials;
use crate::npc_behaviour::npc_home;
use crate::npc_cities::found_npc_city;
use crate::npc_scouts::sector_of;
use crate::npc_test_world::{plains, Runner};
use crate::queries::building::{building_pile, road_at};
use crate::queries::names::held;
use crate::queries::npc_trade::npc_reserve;
use crate::random::{new_id, Mulberry32};
use crate::world::create_world;

/// A node past the set reach and inside the limit.
const FAR: i32 = 300;

struct Town {
    world: WorldState,
    terrain: TerrainMap,
    city: String,
    storage: String,
    home: (i32, i32),
}

impl Town {
    fn people(&self) -> Vec<&csp_shared::world::Resident> {
        self.world.residents.iter().filter(|r| r.city_id.as_deref() == Some(self.city.as_str())).collect()
    }
    fn ci(&self) -> usize {
        self.world.cities.iter().position(|c| c.id == self.city).unwrap()
    }
    fn reserve(&self) -> csp_shared::world::Stock {
        npc_reserve(&self.world, &self.world.cities[self.ci()])
    }
    fn stock_mut(&mut self) -> &mut csp_shared::world::Stock {
        let id = self.storage.clone();
        let b = self.world.buildings.iter_mut().find(|b| b.id == id).unwrap();
        b.stock.get_or_insert_with(Default::default)
    }
}

/// A town alone on Plains with no node of anything near it, and its reserve in store (`town`).
fn town() -> Town {
    let terrain = plains(1300);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    let city = found_npc_city(&mut world, &terrain, &NPC_TOWN, 300, 300, &mut || m.next(), None);
    world.nodes = Vec::new();
    let storage = npc_home(&world, &city).unwrap().clone();
    let mut t = Town { world, terrain, city, storage: storage.id.clone(), home: (storage.x as i32, storage.y as i32) };
    let reserve = t.reserve();
    *t.stock_mut() = reserve;
    t
}

/// A forest node `distance` tiles east of home, its sector heard of (`nodeAt`, `scouted`).
fn scouted_forest(t: &mut Town, distance: i32) -> (i32, i32) {
    let at = (t.home.0 + distance, t.home.1);
    t.terrain.tiles[tile_index(t.terrain.size, at.0, at.1)] = Terrain::Forest as u8;
    let id = new_id("n", &mut t.world.next_id);
    t.world.nodes.push(ResourceNode { id, kind: ResourceKind::Forest, x: at.0 as f64, y: at.1 as f64 });
    let sector = sector_of(t.terrain.size, at.0, at.1);
    let ci = t.ci();
    t.world.cities[ci].scouted = Some(serde_json::from_value(json!({ "sectors": [sector] })).unwrap());
    at
}

fn sound(t: &Town) {
    assert_eq!(check_all(&t.world, &t.terrain), []);
}

#[test]
#[ignore = "timed in the PR"]
fn a_road_follows_out_to_a_far_workplace() {
    let mut t = town();
    let node = scouted_forest(&mut t, FAR);
    let id = new_id("b", &mut t.world.next_id);
    let place: Building = serde_json::from_value(
        json!({ "id": id, "kind": "lumberCamp", "x": node.0, "y": node.1, "cityId": null }),
    )
    .unwrap();
    t.world.buildings.push(place);
    let ci = t.ci();
    t.world.cities[ci].workplace_ids.get_or_insert_with(Vec::new).push(id.clone());
    // Nothing short, and Stone for the whole way.
    let reserve = t.reserve();
    let cap = |g: &str| NPC_SURPLUS_CAP.get(g).unwrap_or(0.0);
    let road_stone = held(&build_materials(BuildingKind::Road), Good::Stone);
    let mut stock = reserve.clone();
    stock.insert(Good::Food, held(&reserve, Good::Food) + 2.0 * cap("food"));
    stock.insert(Good::Wood, held(&reserve, Good::Wood) + cap("wood"));
    stock.insert(Good::Stone, held(&reserve, Good::Stone) + 2.0 * FAR as f64 * road_stone);
    *t.stock_mut() = stock;
    let city = t.city.clone();
    let way = |w: &WorldState| {
        w.city_plans.get(&city)?.roads.as_ref()?.iter().find(|r| r.to == id).map(|r| r.tiles.clone())
    };
    let laid = |w: &WorldState| {
        way(w)
            .unwrap_or_default()
            .iter()
            .filter(|&&(x, y)| road_at(w, x as i32, y as i32).is_some_and(|r| r.site.is_none()))
            .count()
    };
    let built = |w: &WorldState| way(w).is_some_and(|tiles| !tiles.is_empty() && laid(w) == tiles.len());
    let mut runner = Runner::new(&t.terrain);
    let mut i = 0;
    while i < 150 * TICKS_PER_GAME_DAY as usize && !built(&t.world) {
        runner.step(&mut t.world, &t.terrain);
        if i % TICKS_PER_GAME_DAY as usize == 0 {
            sound(&t);
        }
        i += 1;
    }
    let tiles = way(&t.world).expect("a way");
    assert_eq!(tiles.last(), Some(&(node.0 as f64, node.1 as f64)));
    assert!(tiles.len() as f64 > NPC_NODE_REACH);
    assert_eq!(laid(&t.world), tiles.len());
    let scouted = serde_json::to_value(&t.world.cities[t.ci()].scouted).unwrap();
    assert_eq!(scouted.get("noWay"), None);
}

#[test]
#[ignore = "timed in the PR"]
fn a_city_short_of_a_good_builds_on_a_far_node_and_its_crew_stays_fed_there() {
    let mut t = town();
    let node = scouted_forest(&mut t, FAR);
    let reserve = t.reserve();
    let mut stock = reserve.clone();
    stock.insert(Good::Wood, 0.0);
    stock.insert(Good::Food, held(&reserve, Good::Food) + 600.0);
    *t.stock_mut() = stock;
    let size = t.terrain.size;
    let camp = |w: &WorldState| -> Option<Building> {
        w.buildings
            .iter()
            .find(|b| {
                b.kind == BuildingKind::LumberCamp
                    && wrap_distance(size, (b.x as i32, b.y as i32), node) <= 2.0
            })
            .cloned()
    };
    let mut runner = Runner::new(&t.terrain);
    let mut i = 0;
    while i < 60 * TICKS_PER_GAME_DAY as usize && camp(&t.world).is_none_or(|c| c.site.is_some()) {
        runner.step(&mut t.world, &t.terrain);
        if i % TICKS_PER_GAME_DAY as usize == 0 {
            sound(&t);
        }
        i += 1;
    }
    let place = camp(&t.world).expect("a camp on the node");
    assert!(place.site.is_none());
    assert!(t.world.cities[t.ci()].workplace_ids.iter().flatten().any(|id| *id == place.id));
    assert!(wrap_distance(size, t.home, (place.x as i32, place.y as i32)) > NPC_NODE_REACH);

    // Thirty days at it, on the Food the carrier brings. What they bring keeps going out of the
    // store, so Wood stays short and the crew stays.
    let everyone = t.people().len();
    let on_crew = |r: &&&csp_shared::world::Resident| {
        r.script.as_ref().and_then(|s| s.memory.get("workplaceId")) == Some(&Value::from(place.id.clone()))
    };
    let pile = |w: &WorldState| building_pile(w, &place).map_or(0.0, |p| held(&p.goods, Good::Food));
    let mut last_pile = pile(&t.world);
    let (mut brought, mut hungry) = (0, 0);
    for i in 0..30 * TICKS_PER_GAME_DAY as usize {
        t.stock_mut().insert(Good::Wood, 0.0);
        runner.step(&mut t.world, &t.terrain);
        hungry += t.people().iter().filter(on_crew).filter(|r| r.hunger <= 0.0).count();
        let now = pile(&t.world);
        if now > last_pile {
            brought += 1;
        }
        last_pile = now;
        if i % TICKS_PER_GAME_DAY as usize == 0 {
            sound(&t);
        }
    }
    assert!(t.people().iter().filter(on_crew).count() > 0);
    assert!(brought > 0);
    assert!(last_pile <= CREW_FOOD);
    assert_eq!(hungry, 0);
    let down: Vec<&String> = t.people().iter().filter(|r| r.down_until.is_some()).map(|r| &r.id).collect();
    assert_eq!(down, Vec::<&String>::new());
    assert!(t.people().len() >= everyone);
}

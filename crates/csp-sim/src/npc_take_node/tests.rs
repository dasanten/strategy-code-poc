//! Taking a node an NPC city lacks (`CONTEXT.md`: Taking a node).

use csp_shared::balance::{NPC_SITE_ESCORTS, NPC_TOWN};
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, CityProject, CrimeKind, Good, Realm, ResidentOrder, ResourceKind, ResourceNode,
    Stance, Temperament, Tile, WorkOrder, WorldState,
};

use super::{node_to_take, npc_takings_sound, out_on_node, step_npc_take_nodes};
use crate::invariants::check_all;
use crate::npc_chain::short_goods;
use crate::npc_cities::found_npc_city;
use crate::npc_plan::{plan_city, plan_due};
use crate::npc_test_world::Runner;
use crate::queries::building::{node_corner, node_workplace};
use crate::queries::residents::{can_work, is_down};
use crate::random::Mulberry32;
use crate::realm_test_world::plains;
use crate::residents::{new_resident, NewResident};
use crate::world::create_world;

const DAY: usize = TICKS_PER_GAME_DAY as usize;

/// The node kinds and the goods they yield, to find one the town is short of.
const KINDS: [(ResourceKind, Good); 4] = [
    (ResourceKind::Coal, Good::Coal),
    (ResourceKind::IronOre, Good::IronOre),
    (ResourceKind::Stone, Good::Stone),
    (ResourceKind::Forest, Good::Wood),
];

struct Place {
    world: WorldState,
    terrain: TerrainMap,
    city: String,
    /// The node out of its City area, of a good it is short of.
    node: ResourceNode,
}

impl Place {
    /// A town of `temperament` in Expand alone on a Plains map with no nodes, planned once, ten of
    /// its adults armed with a Spear, and one node, 50 tiles off, of a good it is short of.
    fn town(temperament: Temperament) -> Place {
        let mut terrain = plains(300);
        let mut world = create_world(&terrain, 1);
        world.nodes.clear();
        let mut m = Mulberry32::new(7.0);
        let city = found_npc_city(&mut world, &terrain, &NPC_TOWN, 40, 40, &mut || m.next(), None);
        plan_city(&mut world, &city, Some(&terrain), None, None);
        let tick = world.tick as f64;
        let adults: Vec<usize> = (0..world.residents.len())
            .filter(|&i| {
                let r = &world.residents[i];
                r.city_id.as_deref() == Some(city.as_str()) && can_work(r.born_at, tick)
            })
            .collect();
        for &i in adults.iter().take(10) {
            let r = &mut world.residents[i];
            r.carried.insert(Good::Spear, 1.0);
            (r.order, r.script) = (None, None);
        }
        crate::equipment::settle_all(&mut world);
        let c = world.cities.iter_mut().find(|c| c.id == city).expect("the town");
        c.temperament = Some(temperament);
        c.stance = Some(Stance::Expand);
        let c = c.clone();
        let short = short_goods(&world, &c, terrain.size, None);
        let (kind, _) = KINDS
            .into_iter()
            .find(|(_, g)| short.contains(g))
            .unwrap_or_else(|| panic!("the town is short of no node's good: {short:?}"));
        let node = ResourceNode {
            id: "n1".into(),
            kind,
            x: 90.0,
            y: 40.0,
            ..serde_json::from_value(
                serde_json::json!({"id": "n1", "kind": "stone", "x": 0, "y": 0}),
            )
            .expect("a node")
        };
        // On the terrain its kind lies on.
        let fits = crate::invariants::checks::node_terrains(kind)[0];
        terrain.tiles[(40 * terrain.size + 90) as usize] = fits as u8;
        world.nodes.push(node.clone());
        Place { world, terrain, city, node }
    }

    fn city(&self) -> &csp_shared::world::City {
        self.world.cities.iter().find(|c| c.id == self.city).expect("the city")
    }

    /// A finished workplace on the node, in no city.
    fn mine(&mut self) -> String {
        let (x, y) = node_corner(&self.world, &self.terrain, &self.node).expect("room on the node");
        let kind = node_workplace(self.node.kind);
        let mut b: Building =
            serde_json::from_value(serde_json::json!({"id": "w1", "kind": "road", "x": x, "y": y}))
                .expect("a building");
        b.kind = kind;
        self.world.buildings.push(b);
        "w1".into()
    }

    /// Realm r1, founded at `founded_at`, with `workers` working its workplace on the node and
    /// `guards` armed with a Sword standing by it.
    fn held_by_r1(&mut self, workers: usize, guards: usize, founded_at: Option<f64>) -> String {
        let mine = self.mine();
        let (x, y) = {
            let b = self.world.buildings.iter().find(|b| b.id == mine).unwrap();
            (b.x, b.y)
        };
        for i in 0..workers + guards {
            let id = format!("r1-{i}");
            let mut m = Mulberry32::new(i as f64 + 3.0);
            let tick = self.world.tick as f64;
            let fields = NewResident {
                id: &id,
                owner: Some("r1"),
                city_id: None,
                x,
                y: y + i as f64 % 2.0,
                tick,
            };
            let mut r = new_resident(&mut || m.next(), &fields, None);
            r.born_at = tick - 20.0 * 24.0 * 3600.0;
            r.lifespan = 60.0;
            if i < workers {
                r.order = Some(ResidentOrder::WorkAt(WorkOrder {
                    building_id: mine.clone(),
                    at: Tile { x, y },
                    progress: 0.0,
                    makes: None,
                    mends: false,
                }));
            } else {
                r.carried.insert(Good::Sword, 1.0);
            }
            self.world.residents.push(r);
        }
        crate::equipment::settle_all(&mut self.world);
        self.world.realms.push(Realm {
            id: "r1".into(),
            user_id: 7,
            leader_id: "r1-0".into(),
            name: None,
            demands_sent_at: None,
            heir_id: None,
            founded_at,
        });
        mine
    }

    /// Steps only the takings, a tick at a time, through its next planning pass.
    fn run_to_next_pass(&mut self) {
        loop {
            self.world.tick += 1;
            step_npc_take_nodes(&mut self.world, &self.terrain);
            if plan_due(&self.world, &self.city) {
                return;
            }
        }
    }

    fn taking(&self) -> Option<&csp_shared::world::NodeTaking> {
        self.world.city_plans[&self.city].taking.as_ref()
    }
}

#[test]
fn a_city_in_expand_sends_an_escort_with_the_crew_building_on_a_free_node_out_of_its_area() {
    let mut p = Place::town(Temperament::Settler);
    let (x, y) = node_corner(&p.world, &p.terrain, &p.node).expect("room on the node");
    let kind = node_workplace(p.node.kind);
    let project = CityProject::Build { building: kind, x: x as f64, y: y as f64, material: None };
    p.world.city_plans.get_mut(&p.city).unwrap().project = Some(project);
    p.run_to_next_pass();
    let escort = p.world.city_plans[&p.city].site_escort.clone().expect("an escort");
    assert_eq!(escort.len(), NPC_SITE_ESCORTS as usize);
    for id in &escort {
        let r = p.world.residents.iter().find(|r| &r.id == id).unwrap();
        assert!(
            matches!(&r.order, Some(ResidentOrder::WalkTo(o)) if (o.target.x as i32, o.target.y as i32) == (x, y)),
            "{id} doesn't go to the site: {:?}",
            r.order
        );
    }
    assert_eq!(npc_takings_sound(&p.world), vec![]);
    // Once the project is done or given up, they are free again.
    p.world.city_plans.get_mut(&p.city).unwrap().project = None;
    p.run_to_next_pass();
    assert!(p.world.city_plans[&p.city].site_escort.is_none());
    assert!(out_on_node(&p.world, &p.city).is_empty());
}

#[test]
fn a_city_not_in_expand_sends_no_escort() {
    let mut p = Place::town(Temperament::Settler);
    p.world.cities.iter_mut().find(|c| c.id == p.city).unwrap().stance = None;
    let (x, y) = node_corner(&p.world, &p.terrain, &p.node).expect("room on the node");
    let kind = node_workplace(p.node.kind);
    let project = CityProject::Build { building: kind, x: x as f64, y: y as f64, material: None };
    p.world.city_plans.get_mut(&p.city).unwrap().project = Some(project);
    p.run_to_next_pass();
    assert!(p.world.city_plans[&p.city].site_escort.is_none());
}

#[test]
fn a_militarist_city_far_outweighing_a_players_guards_takes_their_mine() {
    let mut p = Place::town(Temperament::Militarist);
    let mine = p.held_by_r1(2, 1, None);
    assert!(node_to_take(&p.world, p.city(), &p.terrain).is_some());
    let mut runner = Runner::new(&p.terrain);
    let mut sent = false;
    for _ in 0..DAY {
        // It picks its stance again each game day; this town stays in Expand until it goes.
        if !sent {
            p.world.cities.iter_mut().find(|c| c.id == p.city).unwrap().stance =
                Some(Stance::Expand);
        }
        runner.step(&mut p.world, &p.terrain);
        sent |= p.taking().is_some();
        if p.city().workplace_ids.iter().flatten().any(|id| id == &mine) {
            break;
        }
    }
    assert!(sent, "it never went for the mine");
    assert!(
        p.city().workplace_ids.iter().flatten().any(|id| id == &mine),
        "the mine isn't its own"
    );
    assert!(p.taking().is_none());
    let r1_up =
        p.world.residents.iter().filter(|r| {
            r.owner.as_deref() == Some("r1") && r.health > 0.0 && !is_down(r.down_until)
        });
    let b = p.world.buildings.iter().find(|b| b.id == mine).unwrap();
    for r in r1_up {
        let d = csp_shared::terrain::wrap_distance(
            p.terrain.size,
            (r.x as i32, r.y as i32),
            (b.x as i32, b.y as i32),
        );
        assert!(d > csp_shared::balance::NPC_NODE_GUARD_RANGE, "{} still holds it", r.id);
    }
    // An attack like any other: a crime against the holder.
    assert!(p
        .world
        .crimes
        .iter()
        .any(|c| c.victim_org == "r1" && matches!(c.kind, CrimeKind::Attack | CrimeKind::Killing)));
    assert_eq!(check_all(&p.world, &p.terrain), vec![]);
}

#[test]
fn a_city_of_another_temperament_takes_nothing() {
    for t in [Temperament::Merchant, Temperament::Settler] {
        let mut p = Place::town(t);
        p.held_by_r1(2, 1, None);
        assert!(node_to_take(&p.world, p.city(), &p.terrain).is_none(), "{t:?}");
        p.run_to_next_pass();
        assert!(p.taking().is_none(), "{t:?}");
    }
}

#[test]
fn a_sheltered_realms_node_is_left_alone() {
    let mut p = Place::town(Temperament::Militarist);
    let now = p.world.tick as f64;
    p.held_by_r1(2, 0, Some(now));
    assert!(node_to_take(&p.world, p.city(), &p.terrain).is_none());
    p.run_to_next_pass();
    assert!(p.taking().is_none());
}

#[test]
fn guards_it_doesnt_far_outweigh_keep_their_mine() {
    let mut p = Place::town(Temperament::Militarist);
    p.held_by_r1(2, 8, None);
    assert!(node_to_take(&p.world, p.city(), &p.terrain).is_some());
    p.run_to_next_pass();
    assert!(p.taking().is_none());
}

#[test]
fn npc_takings_sound_catches_a_taking_of_a_sheltered_realm_or_by_someone_else() {
    let mut p = Place::town(Temperament::Militarist);
    p.held_by_r1(2, 1, None);
    p.run_to_next_pass();
    assert!(p.taking().is_some());
    assert_eq!(npc_takings_sound(&p.world), vec![]);
    let now = p.world.tick as f64;
    p.world.realms[0].founded_at = Some(now);
    let found = npc_takings_sound(&p.world);
    assert!(found.iter().any(|v| v.message.contains("in its shelter")), "{found:?}");
    p.world.realms[0].founded_at = None;
    let plan = p.world.city_plans.get_mut(&p.city).unwrap();
    plan.taking.as_mut().unwrap().soldier_ids.push("r1-0".into());
    let found = npc_takings_sound(&p.world);
    assert!(found.iter().any(|v| v.message.contains("none of its own")), "{found:?}");
}

//! `npc-posts.test.ts`, one test per `it`: Soldier posts (`CONTEXT.md`): an NPC city's soldiers
//! stand on its town hall, at its gates and along its wall, and the invariant that holds them
//! there (`npc-soldiers-on-posts`).

use std::collections::HashSet;
use std::sync::Arc;

use csp_shared::balance::{NpcCitySize, NPC_SOLDIERS_ON_HALL, NPC_VILLAGE, OWN_FOOD};
use csp_shared::footprint::{covers, is_at};
use csp_shared::terrain::{wrap_delta, Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Alarm, Building, BuildingKind, Good, Resident, ResidentOrder, Stock, TradeOrgCity, WorldState,
};
use csp_sim::alarms::start_alarm;
use csp_sim::invariants::check_all;
use csp_sim::npc_behaviour::{npc_home, npc_soldiers_on_posts, step_npc_cities};
use csp_sim::npc_cities::found_npc_city;
use csp_sim::npc_plan::plan_city;
use csp_sim::npc_posts::{free_soldiers, soldier_posts};
use csp_sim::queries::city::town_hall_of;
use csp_sim::queries::names::placed;
use csp_sim::random::Mulberry32;
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::{create_world, step_world};
use serde_json::json;

const SIZE: i32 = 128;

fn staged_terrain() -> TerrainMap {
    TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] }
}

/// A city alone on an open map, its residents free and on its storage, `armed` of them with
/// spears (`staged`).
struct Staged {
    world: WorldState,
    terrain: TerrainMap,
    city: String,
    storage: String,
    hall: String,
}

fn staged(armed: usize, residents: f64) -> Staged {
    let terrain = staged_terrain();
    let mut world = create_world(&terrain, 1);
    let kind = NpcCitySize { residents, ..NPC_VILLAGE };
    let mut m = Mulberry32::new(7.0);
    let city = found_npc_city(&mut world, &terrain, &kind, 30, 30, &mut || m.next(), None);
    let storage = npc_home(&world, &city).unwrap();
    let (storage, sx, sy) = (storage.id.clone(), storage.x, storage.y);
    let c = world.cities.iter().find(|c| c.id == city).unwrap();
    let hall = town_hall_of(&world, c).unwrap().id.clone();
    for (i, r) in world.residents.iter_mut().enumerate() {
        r.x = sx;
        r.y = sy;
        r.order = None;
        r.carried = Stock::from([(Good::Food, OWN_FOOD)]);
        r.script = None;
        if i < armed {
            r.carried.insert(Good::Spear, 1.0);
        }
    }
    Staged { world, terrain, city, storage, hall }
}

impl Staged {
    fn b(&self, id: &str) -> &Building {
        self.world.buildings.iter().find(|b| b.id == id).unwrap()
    }

    fn hall(&self) -> &Building {
        self.b(&self.hall)
    }

    /// Runs the city's pass and one tick of its behaviour (`pass`).
    fn pass(&mut self) {
        plan_city(&mut self.world, &self.city, None, None, None);
        step_npc_cities(&mut self.world, SIZE, None, None);
    }

    /// The city's soldiers, in order of id, by index (`soldiersOf`).
    fn soldiers(&self) -> Vec<usize> {
        let mut out: Vec<usize> = (0..self.world.residents.len())
            .filter(|&i| self.world.residents[i].carried.contains_key(&Good::Spear))
            .collect();
        out.sort_by(|a, b| self.world.residents[*a].id.cmp(&self.world.residents[*b].id));
        out
    }

    fn soldier_ids(&self) -> Vec<String> {
        self.soldiers().into_iter().map(|i| self.world.residents[i].id.clone()).collect()
    }

    fn r(&self, id: &str) -> &Resident {
        self.world.residents.iter().find(|r| r.id == id).unwrap()
    }

    fn r_mut(&mut self, id: &str) -> &mut Resident {
        self.world.residents.iter_mut().find(|r| r.id == id).unwrap()
    }

    /// Where `id` walks to (`target`).
    fn target(&self, id: &str) -> (i32, i32) {
        match &self.r(id).order {
            Some(ResidentOrder::WalkTo(o)) => (o.target.x as i32, o.target.y as i32),
            o => panic!("{id} is not walking: {o:?}"),
        }
    }

    fn on_hall(&self, at: (i32, i32)) -> bool {
        is_at(at, placed(self.hall()), SIZE)
    }

    /// Stands everyone with a walk where it ends (`arrive`).
    fn arrive(&mut self) {
        for r in &mut self.world.residents {
            if let Some(ResidentOrder::WalkTo(o)) = &r.order {
                r.x = o.target.x;
                r.y = o.target.y;
                r.order = None;
            }
        }
    }

    fn remove_walls(&mut self) {
        self.world.buildings.retain(|b| b.kind != BuildingKind::Wall && b.kind != BuildingKind::Gate);
    }

    /// Those of `ids` not set off on a round (`npc-patrols.test.ts`) by the city's pass
    /// (`notOnRound`).
    fn not_on_round(&self, ids: &[String]) -> Vec<String> {
        let out: Vec<String> = self
            .world
            .city_plans
            .get(&self.city)
            .and_then(|p| p.patrols.as_ref())
            .map(|ps| ps.iter().map(|p| p.resident_id.clone()).collect())
            .unwrap_or_default();
        ids.iter().filter(|id| !out.contains(id)).cloned().collect()
    }

    fn tile_of(&self, id: &str) -> (i32, i32) {
        let r = self.r(id);
        (r.x as i32, r.y as i32)
    }

    fn walls(&self) -> Vec<(i32, i32)> {
        self.world
            .buildings
            .iter()
            .filter(|b| b.kind == BuildingKind::Wall)
            .map(|b| (b.x as i32, b.y as i32))
            .collect()
    }

    fn add(&mut self, id: &str, kind: &str, x: f64, y: f64) {
        let b = json!({ "id": id, "kind": kind, "cityId": self.city, "x": x, "y": y });
        self.world.buildings.push(serde_json::from_value(b).unwrap());
    }
}

// Soldier posts (CONTEXT.md)

#[test]
fn sends_soldiers_off_the_storage_to_posts_spread_out_and_leaves_them_there() {
    let mut s = staged(10, 40.0);
    s.pass();
    let soldiers = s.soldier_ids();
    let targets: Vec<(i32, i32)> = soldiers.iter().map(|id| s.target(id)).collect();
    for t in &targets {
        assert!(!is_at(*t, placed(s.b(&s.storage)), SIZE));
    }
    assert!(targets.iter().collect::<HashSet<_>>().len() >= 7);

    // The next passes leave them be: one walk, then nothing.
    s.arrive();
    let where_: Vec<(i32, i32)> = soldiers.iter().map(|id| s.tile_of(id)).collect();
    for id in &soldiers {
        assert!(s.r(id).order.is_none());
    }
    s.pass();
    for id in s.not_on_round(&soldiers) {
        assert!(s.r(&id).order.is_none(), "{id}");
    }
    assert_eq!(soldiers.iter().map(|id| s.tile_of(id)).collect::<Vec<_>>(), where_);
}

#[test]
fn posts_them_on_the_hall_first_then_at_the_gates_then_along_the_wall() {
    let mut s = staged(10, 40.0);
    let gate = s.world.buildings.iter().find(|b| b.kind == BuildingKind::Gate).unwrap();
    let gate = (gate.x as i32, gate.y as i32);
    s.pass();
    let targets: Vec<(i32, i32)> = s.soldier_ids().iter().map(|id| s.target(id)).collect();
    assert!(s.on_hall(targets[0]));
    assert!(s.on_hall(targets[1]));
    assert_eq!(targets[2], gate);
    let walls = s.walls();
    for t in &targets[3..] {
        assert!(walls.contains(t), "{t:?}");
    }
}

#[test]
fn with_few_soldiers_holds_the_hall_before_anything_else() {
    let mut s = staged(1, 6.0);
    s.pass();
    let first = s.soldier_ids()[0].clone();
    assert!(s.on_hall(s.target(&first)));
}

#[test]
fn in_a_city_with_no_wall_uses_the_hall_and_the_ground_around_it_not_other_buildings() {
    let mut s = staged(10, 40.0);
    s.remove_walls();
    s.pass();
    let targets: Vec<(i32, i32)> = s.soldier_ids().iter().map(|id| s.target(id)).collect();
    let on_hall = NPC_SOLDIERS_ON_HALL as usize;
    for t in &targets[..on_hall] {
        assert!(s.on_hall(*t));
    }
    let hall = s.hall();
    for t in &targets[on_hall..] {
        assert!(!covers(placed(hall), t.0, t.1, SIZE));
        let dx = wrap_delta(hall.x as i32 + 1, t.0, SIZE).abs();
        let dy = wrap_delta(hall.y as i32 + 1, t.1, SIZE).abs();
        assert!(dx.max(dy) <= 3, "{t:?}");
        let on: Vec<&str> = s
            .world
            .buildings
            .iter()
            .filter(|b| b.kind != BuildingKind::Road && covers(placed(b), t.0, t.1, SIZE))
            .map(|b| b.id.as_str())
            .collect();
        assert!(on.is_empty(), "{t:?} on {on:?}");
    }
    assert!(targets.iter().collect::<HashSet<_>>().len() >= 6);
}

#[test]
fn leaves_a_wall_still_going_up_with_no_gate_to_get_onto_it_from_alone() {
    let mut s = staged(10, 40.0);
    s.world.buildings.retain(|b| b.kind != BuildingKind::Gate);
    let walls: HashSet<(i32, i32)> = s.walls().into_iter().collect();
    s.pass();
    for id in s.soldier_ids() {
        assert!(!walls.contains(&s.target(&id)), "{id}");
    }
}

#[test]
fn adds_the_ground_around_the_hall_while_its_wall_has_too_few_tiles_for_them() {
    let mut s = staged(10, 40.0);
    s.remove_walls();
    let (hx, hy) = (s.hall().x, s.hall().y);
    s.add("g", "gate", hx + 12.0, hy);
    s.add("w", "wall", hx + 12.0, hy + 1.0);
    s.pass();
    let near = s
        .soldier_ids()
        .iter()
        .map(|id| s.target(id))
        .filter(|t| wrap_delta(hx as i32, t.0, SIZE).abs() <= 5)
        .count();
    assert!(near >= 6, "{near}");
}

#[test]
fn moves_nobody_on_the_wall_when_another_stretch_of_it_goes_up() {
    let mut s = staged(10, 40.0);
    s.pass();
    s.arrive();
    let rest: Vec<String> = s.soldier_ids()[NPC_SOLDIERS_ON_HALL as usize + 1..].to_vec();
    let where_: Vec<(i32, i32)> = rest.iter().map(|id| s.tile_of(id)).collect();
    let east = s
        .world
        .buildings
        .iter()
        .filter(|b| b.kind == BuildingKind::Wall)
        .fold(None::<&Building>, |a, b| match a {
            Some(a) if b.x <= a.x => Some(a),
            _ => Some(b),
        })
        .unwrap();
    let (ex, ey) = (east.x, east.y);
    for i in 1..=6 {
        s.add(&format!("new{i}"), "wall", ex + f64::from(i), ey);
    }
    s.pass();
    for id in s.not_on_round(&rest) {
        assert!(s.r(&id).order.is_none(), "{id}");
    }
    assert_eq!(rest.iter().map(|id| s.tile_of(id)).collect::<Vec<_>>(), where_);
}

#[test]
fn keeps_one_on_the_hall_when_those_on_it_are_called_away() {
    let mut s = staged(10, 40.0);
    s.pass();
    s.arrive();
    let on_hall: Vec<usize> =
        s.soldiers().into_iter().filter(|&i| s.on_hall(s.tile_of(&s.world.residents[i].id))).collect();
    assert_eq!(on_hall.len(), NPC_SOLDIERS_ON_HALL as usize);
    let alarm: Alarm = serde_json::from_value(json!({
        "kind": "outsider", "cityId": s.city, "about": "x", "realmId": null, "x": 0, "y": 0,
        "tick": s.world.tick,
    }))
    .unwrap();
    for i in on_hall {
        start_alarm(&mut s.world, i, &alarm);
    }
    // The hall goes to the next by id: whoever was at the gate goes up to it.
    s.pass();
    let going = s
        .soldier_ids()
        .iter()
        .filter(|id| match &s.r(id).order {
            Some(ResidentOrder::WalkTo(o)) => s.on_hall((o.target.x as i32, o.target.y as i32)),
            _ => false,
        })
        .count();
    assert_eq!(going, NPC_SOLDIERS_ON_HALL as usize);
    s.world.tick += 1;
    assert_eq!(npc_soldiers_on_posts(&s.world, &staged_terrain()), vec![]);
}

#[test]
fn turns_one_on_the_way_to_their_old_post_round_when_the_hall_needs_them() {
    let mut s = staged(10, 40.0);
    s.pass();
    // All still walking; the first two die, so the next two are for the hall.
    let ids = s.soldier_ids();
    let (a, b, c, d) = (ids[0].clone(), ids[1].clone(), ids[2].clone(), ids[3].clone());
    assert!(!s.on_hall(s.target(&c)));
    s.world.residents.retain(|r| r.id != a && r.id != b);
    s.pass();
    assert!(s.on_hall(s.target(&c)));
    assert!(s.on_hall(s.target(&d)));
}

#[test]
fn takes_a_load_to_the_storage_before_going_to_a_post() {
    let mut s = staged(4, 40.0);
    s.remove_walls();
    let id = s.soldier_ids()[0].clone();
    s.r_mut(&id).carried.insert(Good::Wood, 5.0);
    s.pass();
    let o = serde_json::to_value(&s.r(&id).order).unwrap();
    assert_eq!(o["kind"], "drop", "{o}");
    assert_eq!(o["to"]["storageId"], json!(s.storage));
}

#[test]
fn does_not_send_a_soldier_on_a_post_back_to_the_storage_for_food() {
    let mut s = staged(4, 40.0);
    s.remove_walls();
    s.pass();
    s.arrive();
    let id = s.soldier_ids().into_iter().find(|id| s.on_hall(s.tile_of(id))).unwrap();
    s.r_mut(&id).carried.insert(Good::Food, 1.5);
    s.pass();
    assert!(s.r(&id).order.is_none());
    step_npc_cities(&mut s.world, SIZE, None, None);
    assert!(s.r(&id).order.is_none());
}

#[test]
fn leaves_a_trade_org_city_to_its_own_rules() {
    let mut s = staged(4, 40.0);
    let city = s.world.cities.iter_mut().find(|c| c.id == s.city).unwrap();
    city.trade_org = Some(TradeOrgCity::Post);
    let city = s.world.cities.iter().find(|c| c.id == s.city).unwrap();
    assert!(soldier_posts(&s.world, city, &s.soldiers(), SIZE, None).is_empty());
    s.pass();
    for id in s.soldier_ids() {
        let walks_to_hall = match &s.r(&id).order {
            Some(ResidentOrder::WalkTo(o)) => s.on_hall((o.target.x as i32, o.target.y as i32)),
            _ => false,
        };
        assert!(!walks_to_hall, "{id}");
    }
}

#[test]
fn stands_none_while_its_hall_is_a_site_and_those_at_a_script_keep_it() {
    let mut s = staged(4, 40.0);
    let hall = s.hall.clone();
    let b = s.world.buildings.iter_mut().find(|b| b.id == hall).unwrap();
    b.site = Some(serde_json::from_value(json!({ "work": 0, "delivered": {} })).unwrap());
    let city = s.world.cities.iter().find(|c| c.id == s.city).unwrap();
    assert!(soldier_posts(&s.world, city, &s.soldiers(), SIZE, None).is_empty());
    let b = s.world.buildings.iter_mut().find(|b| b.id == hall).unwrap();
    b.site = None;
    let first = s.soldiers()[0];
    s.world.residents[first].script = Some(
        serde_json::from_value(json!({ "scriptId": 0, "task": "build", "memory": {} })).unwrap(),
    );
    let city = s.world.cities.iter().find(|c| c.id == s.city).unwrap();
    let all: Vec<usize> = (0..s.world.residents.len()).collect();
    assert!(!free_soldiers(&s.world, city, &all).contains(&first));
}

/// Far from the city, out of its sight and its area.
const AWAY: (f64, f64) = (100.0, 100.0);

/// An armed grown resident of realm r1 at `at`, their Leader far away (`armedOutsider`).
fn armed_outsider(world: &mut WorldState, at: (f64, f64)) -> String {
    let tick = world.tick as f64;
    let make = |world: &mut WorldState, id: &str, x: f64, y: f64| {
        let mut m = Mulberry32::new(world.residents.len() as f64 + 1.0);
        let fields = csp_sim::residents::NewResident {
            id,
            owner: Some("r1"),
            city_id: None,
            x,
            y,
            tick,
        };
        let mut r = csp_sim::residents::new_resident(&mut || m.next(), &fields, None);
        r.born_at = tick - 20.0 * 24.0 * 3600.0;
        r.lifespan = 60.0;
        world.residents.push(r);
        world.residents.len() - 1
    };
    make(world, "leader", AWAY.0, AWAY.1);
    world.realms.push(
        serde_json::from_value(json!({ "id": "r1", "userId": 7, "leaderId": "leader" })).unwrap(),
    );
    let i = make(world, "p1", at.0, at.1);
    world.residents[i].carried.insert(Good::Sword, 1.0);
    "p1".into()
}

/// The world stepped with walking, as the game steps it.
struct Running {
    walking: Walking,
    scratch: Scratch,
}

impl Running {
    fn new(terrain: &TerrainMap) -> Self {
        Running { walking: Walking::new(Arc::new(terrain.clone())), scratch: Scratch::default() }
    }

    fn step(&mut self, s: &mut Staged) {
        step_world(&mut s.world, &s.terrain, &mut self.scratch, Some(&mut self.walking), None);
    }
}

// Soldier posts, in the running world

#[test]
fn an_alarm_takes_them_off_their_posts_to_the_hall_and_they_go_back() {
    let mut s = staged(10, 40.0);
    let mut running = Running::new(&s.terrain);
    let walls: Vec<Building> =
        s.world.buildings.iter().filter(|b| b.kind == BuildingKind::Wall).cloned().collect();
    let soldiers = s.soldier_ids();
    let on_wall = |s: &Staged, id: &str| walls.iter().any(|w| is_at(s.tile_of(id), placed(w), SIZE));
    let until = |s: &mut Staged, running: &mut Running, done: &dyn Fn(&Staged) -> bool| {
        for _ in 0..TICKS_PER_GAME_DAY as usize {
            if done(s) {
                break;
            }
            running.step(s);
            let broken: Vec<String> =
                check_all(&s.world, &s.terrain).into_iter().map(|v| v.message).collect();
            assert_eq!(broken, Vec::<String>::new());
        }
        assert!(done(s));
    };

    // They walk there on their own, and the hall is held all along.
    let want = soldiers.len() - NPC_SOLDIERS_ON_HALL as usize - 1;
    until(&mut s, &mut running, &|s| soldiers.iter().filter(|id| on_wall(s, id)).count() >= want);
    let held = soldiers.iter().filter(|id| s.on_hall(s.tile_of(id))).count();
    assert_eq!(held, NPC_SOLDIERS_ON_HALL as usize);
    let posted = soldiers.iter().find(|id| on_wall(&s, id)).unwrap().clone();

    // An armed outsider comes into the area: those who see them leave their posts for the hall.
    let (px, py) = (s.r(&posted).x, s.r(&posted).y);
    let p = armed_outsider(&mut s.world, (px - 3.0, py));
    let task = |s: &Staged, id: &str| {
        serde_json::to_value(&s.r(id).script).unwrap()["task"].as_str().map(str::to_string)
    };
    until(&mut s, &mut running, &|s| task(s, &posted).as_deref() == Some("alarm"));
    until(&mut s, &mut running, &|s| s.on_hall(s.tile_of(&posted)));
    assert!(!on_wall(&s, &posted));

    // Gone again, they stand down and go back to the wall.
    let outsider = s.r_mut(&p);
    outsider.x = AWAY.0;
    outsider.y = AWAY.1;
    until(&mut s, &mut running, &|s| task(s, &posted).as_deref() != Some("alarm"));
    until(&mut s, &mut running, &|s| on_wall(s, &posted));
    assert!(s.r(&posted).script.is_none());
}

#[test]
fn a_soldier_on_the_hall_blocks_an_occupation_without_any_alarm() {
    let mut s = staged(4, 40.0);
    s.remove_walls();
    let mut running = Running::new(&s.terrain);
    let soldiers = s.soldier_ids();
    for _ in 0..(TICKS_PER_GAME_DAY / 4.0) as usize {
        running.step(&mut s);
    }
    assert!(soldiers.iter().filter(|id| s.on_hall(s.tile_of(id))).count() >= 1);
    let (hx, hy) = (s.hall().x, s.hall().y);
    armed_outsider(&mut s.world, (hx + 1.0, hy + 1.0));
    running.step(&mut s);
    let city = s.world.cities.iter().find(|c| c.id == s.city).unwrap();
    assert!(city.occupation.is_none(), "{:?}", city.occupation);
}

#[test]
#[ignore = "9 s alone; see #1092"]
fn those_on_posts_along_a_wall_stay_fed_from_the_storage() {
    let mut s = staged(6, 40.0);
    let mut running = Running::new(&s.terrain);
    let soldiers = s.soldier_ids();
    for id in &soldiers {
        s.r_mut(id).carried.insert(Good::Food, 2.0);
    }
    for _ in 0..(3.0 * TICKS_PER_GAME_DAY) as usize {
        running.step(&mut s);
    }
    for id in &soldiers {
        let r = s.r(id);
        assert!(r.health > 0.0, "{id}");
        assert!(r.carried.get(&Good::Food).copied().unwrap_or(0.0) > 0.0, "{id}");
    }
}

// npcSoldiersOnPosts

#[test]
fn holds_once_a_pass_has_sent_them() {
    let mut s = staged(10, 40.0);
    s.pass();
    s.world.tick += 1;
    assert_eq!(npc_soldiers_on_posts(&s.world, &s.terrain), vec![]);
}

/// Stands every soldier on the storage, with no order.
fn crowd_the_storage(s: &mut Staged) {
    let (x, y) = (s.b(&s.storage).x, s.b(&s.storage).y);
    for i in s.soldiers() {
        let r = &mut s.world.residents[i];
        r.x = x;
        r.y = y;
        r.order = None;
    }
}

#[test]
fn catches_a_crowd_of_soldiers_on_the_storage_and_a_hall_nobody_goes_to() {
    let mut s = staged(10, 40.0);
    plan_city(&mut s.world, &s.city, None, None, None);
    s.world.tick += 1;
    crowd_the_storage(&mut s);
    let found: Vec<String> =
        npc_soldiers_on_posts(&s.world, &s.terrain).into_iter().map(|v| v.message).collect();
    assert_eq!(
        found,
        [
            format!("10 soldiers of {} stand on its storage", s.city),
            format!("nobody holds or is going to the town hall of {}", s.city),
        ]
    );
}

#[test]
fn does_not_look_before_a_pass_is_over_or_between_passes() {
    let mut s = staged(10, 40.0);
    plan_city(&mut s.world, &s.city, None, None, None);
    assert_eq!(npc_soldiers_on_posts(&s.world, &s.terrain), vec![]);
    s.world.tick += 30;
    crowd_the_storage(&mut s);
    assert_eq!(npc_soldiers_on_posts(&s.world, &s.terrain), vec![]);
}

#[test]
fn leaves_a_trade_org_city_out() {
    let mut s = staged(10, 40.0);
    plan_city(&mut s.world, &s.city, None, None, None);
    s.world.tick += 1;
    let city = s.world.cities.iter_mut().find(|c| c.id == s.city).unwrap();
    city.trade_org = Some(TradeOrgCity::Post);
    assert_eq!(npc_soldiers_on_posts(&s.world, &s.terrain), vec![]);
}

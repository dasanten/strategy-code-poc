//! `apps/server/src/npc-residents-kept-going.test.ts`: residents an NPC city runs are never left
//! doing nothing (`CONTEXT.md`: NPC city), whether Carrying a child, taken on after a Leader's
//! death, or stuck in a running world.

use std::sync::Arc;

use csp_shared::balance::WORKPLACE_MAX_WORKERS;
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, Good, Resident, ResidentOrder, Stock, Task, WorldState,
};
use serde_json::{json, Value};

use super::{is_npc_order, npc_residents_kept_going};
use crate::invariants::check_all;
use crate::npc_defence::step_npc_defence;
use crate::npc_plan::plan_city;
use crate::npc_test_world::{storage_of, village, Village};
use crate::order_sender::OrderSender;
use crate::orders::order_kinds;
use crate::queries::building::{building_pile, recipe_for};
use crate::queries::city_area::in_city_area;
use crate::queries::npc_trade::NPC_SMITHY_WEAPON;
use crate::queries::residents::{carry_capacity, is_armed};
use crate::random::Mulberry32;
use crate::residents::{new_resident, NewResident};
use crate::script_runner::{ScriptHost, ScriptRunner};
use crate::script_tables::DEFAULT_SCRIPTS;
use crate::scripts::RunnableScript;
use crate::survival::end_realm;
use crate::test_world::{city_terrain, world_with_city};
use crate::tick::Scratch;
use crate::walking::Walking;
use crate::world::step_world;

/// A game day in ticks.
const DAY: usize = TICKS_PER_GAME_DAY as usize;

fn from<T: serde::de::DeserializeOwned>(v: Value) -> T {
    serde_json::from_value(v).expect("as the TypeScript writes it")
}

fn food(n: f64) -> Stock {
    [(Good::Food, n)].into_iter().collect()
}

/// Starts resident `ri` carrying a child of `pi`, having carried for `days` game days already
/// (`startCarrying`).
fn start_carrying(world: &mut WorldState, ri: usize, pi: usize, days: f64) {
    let (rid, pid, pname) = (
        world.residents[ri].id.clone(),
        world.residents[pi].id.clone(),
        world.residents[pi].name.clone(),
    );
    let since = world.tick as f64 - days * TICKS_PER_GAME_DAY;
    world.residents[ri].pair = Some(from(json!({ "partnerId": pid, "since": 0 })));
    world.residents[pi].pair = Some(from(json!({ "partnerId": rid, "since": 0 })));
    let r = &mut world.residents[ri];
    r.carrying = Some(from(json!({
        "since": since, "partnerId": pid, "partnerName": pname,
        "partnerBase": { "strength": 10, "endurance": 10, "agility": 10, "intellect": 10 }
    })));
    r.order = None;
    r.script = None;
}

/// A village down to two adults: `a` far east of home, `b` on the farm (`coupleAway`).
fn couple_away() -> Village {
    let mut v = village(None);
    v.world.residents.truncate(2);
    v.world.residents[0].x = v.home.x + 60.0;
    v
}

fn messages(world: &WorldState, terrain: &TerrainMap) -> Vec<String> {
    check_all(world, terrain)
        .into_iter()
        .map(|v| format!("{}: {}", v.invariant, v.message))
        .collect()
}

fn in_city(world: &WorldState, city: &str, r: &Resident, size: i32) -> bool {
    in_city_area(world, city, r.x, r.y, size)
}

fn task_of(r: &Resident) -> Option<Task> {
    r.script.as_ref().and_then(|s| s.task)
}

fn job_kind(world: &WorldState, city: &str, id: &str) -> Option<String> {
    world
        .city_plans
        .get(city)
        .and_then(|p| p.jobs.get(id))
        .map(|j| serde_json::to_value(j).expect("a job")["kind"].as_str().unwrap().to_string())
}

mod an_npc_resident_carrying_a_child {
    use super::*;

    #[test]
    fn with_hands_full_and_no_food_far_from_home_puts_the_load_away_eats_at_home_and_works_after_the_birth(
    ) {
        let Village { mut world, terrain, city, .. } = couple_away();
        // A carrier on the way home with a full load, who has eaten their Food.
        let cap = carry_capacity(&world.residents[0], world.tick as f64).floor();
        world.residents[0].carried = [(Good::Wood, cap)].into_iter().collect();
        // The Food the city has isn't a surplus, so it wants a second farmer once the child is
        // born.
        let si = storage_of(&world, &city);
        world.buildings[si].stock = Some(food(12.0));
        start_carrying(&mut world, 0, 1, 3.0);
        let a = world.residents[0].id.clone();
        let mut walking = Walking::new(Arc::new(terrain.clone()));
        let mut scratch = Scratch::default();
        let me = |w: &WorldState| w.residents.iter().find(|r| r.id == a).cloned().expect("a");
        let mut t = 0;
        while me(&world).carrying.is_some() {
            assert!(t < 60 * DAY, "never born");
            step_world(&mut world, &terrain, &mut scratch, Some(&mut walking), None);
            let r = me(&world);
            assert_eq!(r.down_until, None);
            assert!(r.script.is_none());
            if world.tick % TICKS_PER_GAME_DAY as u64 == 0 {
                assert_eq!(messages(&world, &terrain), Vec::<String>::new());
            }
            t += 1;
        }
        // Home, with the load in the storage.
        let r = me(&world);
        assert!(in_city(&world, &city, &r, terrain.size));
        assert_eq!(r.carried.get(&Good::Wood).copied().unwrap_or(0.0), 0.0);
        let wood = world.buildings[si].stock.as_ref().and_then(|s| s.get(&Good::Wood)).copied();
        assert!(wood.unwrap_or(0.0) > 0.0);
        assert_eq!(world.residents.len(), 3);
        // The next planning pass gives them work again.
        for _ in 0..DAY {
            if task_of(&me(&world)) == Some(Task::Work) {
                break;
            }
            step_world(&mut world, &terrain, &mut scratch, Some(&mut walking), None);
        }
        assert_eq!(job_kind(&world, &city, &a).as_deref(), Some("farm"));
        assert_eq!(task_of(&me(&world)), Some(Task::Work));
        assert_eq!(me(&world).down_until, None);
    }

    #[test]
    fn walks_home_through_its_own_closed_gates_on_the_food_they_have_and_eats_there() {
        let Village { mut world, terrain, city, .. } = couple_away();
        world.residents[0].carried = food(1.0);
        let si = storage_of(&world, &city);
        world.buildings[si].stock = Some(food(12.0));
        start_carrying(&mut world, 0, 1, 0.0);
        let gates: Vec<usize> = (0..world.buildings.len())
            .filter(|&i| {
                let b = &world.buildings[i];
                b.kind == BuildingKind::Gate && b.city_id.as_deref() == Some(city.as_str())
            })
            .collect();
        assert!(!gates.is_empty());
        let a = world.residents[0].id.clone();
        let mut walking = Walking::new(Arc::new(terrain.clone()));
        let mut scratch = Scratch::default();
        for _ in 0..6 * DAY {
            for &g in &gates {
                world.buildings[g].closed = Some(true);
            }
            step_world(&mut world, &terrain, &mut scratch, Some(&mut walking), None);
            assert_eq!(world.residents.iter().find(|r| r.id == a).unwrap().down_until, None);
        }
        let r = world.residents.iter().find(|r| r.id == a).unwrap();
        assert!(in_city(&world, &city, r, terrain.size));
        assert!(r.order.is_none());
        assert!(r.carried.get(&Good::Food).copied().unwrap_or(0.0) >= 1.0);
    }

    #[test]
    fn at_home_with_an_empty_storage_eats_once_the_farms_crew_brings_food_home() {
        let Village { mut world, terrain, city, home } = village(None);
        let a = &mut world.residents[0];
        (a.x, a.y) = (home.x, home.y);
        a.carried = food(1.0);
        let si = storage_of(&world, &city);
        world.buildings[si].stock = Some(Stock::new());
        start_carrying(&mut world, 0, 1, 0.0);
        let a = world.residents[0].id.clone();
        let mut walking = Walking::new(Arc::new(terrain.clone()));
        let mut scratch = Scratch::default();
        for _ in 0..8 * DAY {
            step_world(&mut world, &terrain, &mut scratch, Some(&mut walking), None);
            assert_eq!(world.residents.iter().find(|r| r.id == a).unwrap().down_until, None);
        }
        assert!(world.residents.iter().find(|r| r.id == a).unwrap().hunger > 0.0);
    }

    #[test]
    fn isnt_sent_for_the_smiths_iron_and_wood_which_they_couldnt_forge() {
        let Village { mut world, terrain, city, home } = village(None);
        let hall_id = world.cities.iter().find(|c| c.id == city).unwrap().town_hall_id.clone();
        let hall = world.buildings.iter().find(|b| b.id == hall_id).unwrap().clone();
        world.buildings.push(Building {
            id: "smithy".into(),
            kind: BuildingKind::Smithy,
            city_id: None,
            realm_id: None,
            x: hall.x + 3.0,
            y: hall.y,
            stock: None,
            site: None,
            teardown: None,
            closed: None,
            damage: None,
            breedings: None,
        });
        world.cities.iter_mut().find(|c| c.id == city).unwrap().workplace_ids =
            Some(vec!["smithy".into()]);
        let weapon = serde_json::to_value(NPC_SMITHY_WEAPON).unwrap();
        let recipe = recipe_for(BuildingKind::Smithy, weapon.as_str()).expect("a recipe");
        let mut stock = food(100.0);
        for (g, n) in recipe.input.0 {
            stock.insert(from(json!(g)), *n);
        }
        let si = storage_of(&world, &city);
        world.buildings[si].stock = Some(stock);
        let a = &mut world.residents[0];
        (a.x, a.y) = (home.x, home.y);
        a.carried = food(2.0);
        start_carrying(&mut world, 0, 1, 0.0);
        step_npc_defence(&mut world, terrain.size);
        assert!(world.residents[0].order.is_none());
    }
}

/// Every Player running the game's default scripts unedited (`defaultScripts` of
/// `test-default-scripts.ts`): a Player's version of a task's default has the id `userId * 100`
/// plus the task's place in `TASKS`, from 1.
struct Defaults;

impl ScriptHost for Defaults {
    fn script(&self, id: u64) -> Option<RunnableScript> {
        let (task, name, source) = DEFAULT_SCRIPTS.get((id % 100).checked_sub(1)? as usize)?;
        Some(RunnableScript {
            user_id: id / 100,
            name: name.to_string(),
            version: 1,
            source: source.to_string(),
            follows_default: true,
            task: Some(*task),
        })
    }
    fn sender(&self, user_id: u64) -> Option<OrderSender> {
        (user_id == 1).then(|| OrderSender::player(1, "P1"))
    }
    fn explored(&self, _: u64, _: i32, _: i32) -> bool {
        true
    }
    fn default_script(&self, user_id: u64, task: Task) -> Option<u64> {
        let place = DEFAULT_SCRIPTS.iter().position(|(t, _, _)| *t == task)?;
        Some(user_id * 100 + place as u64 + 1)
    }
}

/// Player 1's realm in play: their residents have real scripts, as from their first tick
/// (`realmInPlay`).
struct InPlay {
    world: WorldState,
    terrain: &'static TerrainMap,
    realm: String,
    city: String,
    farm: Building,
    storage: usize,
    hall: Building,
    runner: ScriptRunner,
    walking: Walking,
    scratch: Scratch,
    rand: Mulberry32,
}

fn realm_in_play() -> InPlay {
    let terrain = city_terrain();
    let mut world = world_with_city();
    let realm = world.realms[0].id.clone();
    let city = world.cities[0].id.clone();
    let map = Arc::new(terrain.clone());
    let mut runner = ScriptRunner::new(map.clone(), Arc::new(Defaults), order_kinds());
    let mut scratch = Scratch::default();
    runner.run_all(&mut world, &mut scratch, true);
    let farm = world
        .buildings
        .iter()
        .find(|b| b.kind == BuildingKind::Farm && b.city_id.as_deref() == Some(city.as_str()))
        .expect("a farm")
        .clone();
    let storage = storage_of(&world, &city);
    let hall_id = world.cities[0].town_hall_id.clone();
    let hall = world.buildings.iter().find(|b| b.id == hall_id).expect("a town hall").clone();
    InPlay {
        world,
        terrain,
        realm,
        city,
        farm,
        storage,
        hall,
        runner,
        walking: Walking::new(map),
        scratch,
        rand: Mulberry32::new(5.0),
    }
}

impl InPlay {
    fn add(&mut self, id: &str, at: (f64, f64), set: impl FnOnce(&mut Resident)) -> String {
        let fields = NewResident {
            id,
            owner: Some(&self.realm),
            city_id: Some(&self.city),
            x: at.0,
            y: at.1,
            tick: 0.0,
        };
        let rand = &mut self.rand;
        let mut r = new_resident(&mut || rand.next(), &fields, None);
        r.carried = food(1.0);
        set(&mut r);
        self.world.residents.push(r);
        id.to_string()
    }

    fn work_at(&self) -> ResidentOrder {
        from(json!({
            "kind": "workAt", "buildingId": self.farm.id,
            "at": { "x": self.farm.x, "y": self.farm.y }, "progress": 0
        }))
    }

    /// Fills the farm with the realm's workers by their Work script, the Leader's place too.
    fn fill_farm(&mut self) {
        let farm = self.farm.id.clone();
        let script_id = self
            .world
            .residents
            .iter()
            .find_map(|r| {
                r.script
                    .as_ref()
                    .filter(|s| s.memory.get("workplaceId").and_then(Value::as_str) == Some(&farm))
                    .map(|s| s.script_id)
            })
            .expect("a farm worker by script");
        let most = WORKPLACE_MAX_WORKERS.get("farm").expect("a farm's crew") as usize;
        let at = (self.farm.x, self.farm.y);
        for i in self.world.residents.len()..=most {
            let order = self.work_at();
            let farm = farm.clone();
            self.add(&format!("worker{i}"), at, move |r| {
                r.order = Some(order);
                r.script =
                    Some(from(json!({ "scriptId": script_id, "memory": { "workplaceId": farm } })));
            });
        }
    }

    /// The Leader is dead: the realm ended, and its city self-managed.
    fn leader_dies(&mut self) {
        let leader = self.world.realms[0].leader_id.clone();
        self.world.residents.retain(|r| r.id != leader);
        let realm = self.realm.clone();
        end_realm(&mut self.world, &realm, self.terrain.size);
    }

    fn tick(&mut self) {
        self.runner.run_all(&mut self.world, &mut self.scratch, true);
        step_world(&mut self.world, self.terrain, &mut self.scratch, Some(&mut self.walking), None);
    }

    fn r(&self, id: &str) -> &Resident {
        self.world.residents.iter().find(|r| r.id == id).expect("a resident")
    }
}

/// Why a grown resident of a self-managed `city` is left doing nothing, if they are (`stuck`).
fn stuck(world: &WorldState, terrain: &TerrainMap, city: &str, r: &Resident) -> Vec<String> {
    let o = r.order.as_ref();
    let away = !in_city_area(world, city, r.x, r.y, terrain.size);
    let kind = o.map(|o| serde_json::to_value(o).unwrap()["kind"].as_str().unwrap().to_string());
    let mut out = Vec::new();
    if r.down_until.is_some() {
        out.push("is Down".to_string());
    }
    if world.city_plans.get(city).and_then(|p| p.jobs.get(&r.id)).is_none() {
        out.push("has no job".into());
    }
    if let Some(o) = o.filter(|o| !is_npc_order(o)) {
        let _ = o;
        out.push(format!("holds a {} order", kind.clone().unwrap()));
    }
    if matches!(o, Some(ResidentOrder::WorkAt(_))) && r.script.is_none() {
        out.push("works by a bare work-at order".into());
    }
    if let Some(s) = r.script.as_ref().filter(|s| s.script_id != 0) {
        out.push(format!("runs the Player's script {}", s.script_id));
    }
    if away && o.is_none() && r.script.is_none() {
        out.push("stands away from home with nothing to do".into());
    }
    if r.aboard.is_some() {
        out.push("stays aboard a carriage".into());
    }
    out
}

mod after_a_leader_death {
    use super::*;

    #[test]
    fn a_full_farm_carries_its_food_home_so_those_who_were_not_working_do_not_go_down() {
        let mut s = realm_in_play();
        s.fill_farm();
        let at = (s.hall.x, s.hall.y + 1.0);
        let idle: Vec<String> = (0..3).map(|i| s.add(&format!("idle{i}"), at, |_| {})).collect();
        s.world.buildings[s.storage].stock = Some(Stock::new());
        s.leader_dies();
        for _ in 0..8 * DAY {
            s.tick();
            let down: Vec<&String> =
                idle.iter().filter(|id| s.r(id).down_until.is_some()).collect();
            assert_eq!(down, Vec::<&String>::new());
        }
        assert_eq!(messages(&s.world, s.terrain), Vec::<String>::new());
        assert!(s.world.residents.iter().all(|r| r.down_until.is_none()));
        // Food gets from the farm to the storage, and the crew goes on by the Work default.
        let stored = s.world.buildings[s.storage].stock.as_ref().and_then(|x| x.get(&Good::Food));
        assert!(stored.copied().unwrap_or(0.0) > 0.0);
        let piled = building_pile(&s.world, &s.farm).and_then(|p| p.goods.get(&Good::Food));
        assert!(piled.copied().unwrap_or(0.0) < 100.0);
        let crew: Vec<&Resident> = s
            .world
            .residents
            .iter()
            .filter(|r| matches!(r.order, Some(ResidentOrder::WorkAt(_))))
            .collect();
        assert!(!crew.is_empty());
        for r in crew {
            let script = r.script.as_ref().expect("a script");
            assert_eq!((script.script_id, script.task), (0, Some(Task::Work)), "{}", r.id);
        }
    }

    #[test]
    fn a_resident_gets_a_job_or_walks_home_whatever_order_or_task_they_had() {
        let mut s = realm_in_play();
        s.world.buildings[s.storage].stock = Some(food(200.0));
        let home = (s.hall.x, s.hall.y + 1.0);
        let far = (s.hall.x + 60.0, s.hall.y);
        let carriage = s.world.carriages[0].clone();
        let horse = s.world.horses[0].clone();
        let drive: ResidentOrder = from(json!({
            "kind": "drive", "carriageId": carriage.id, "target": { "x": s.hall.x, "y": s.hall.y },
            "path": null, "progress": 0
        }));
        let walk: ResidentOrder = from(json!({
            "kind": "walkTo", "target": { "x": far.0 + 2.0, "y": far.1 }, "path": null, "progress": 0
        }));
        let city = s.city.clone();
        let mut named = vec![
            s.add("idle-home", home, |_| {}),
            s.add("idle-away", far, |_| {}),
            s.add("walking-away", far, |r| r.order = Some(walk)),
            s.add("driving", (carriage.x, carriage.y), |r| r.order = Some(drive.clone())),
            s.add("aboard", (carriage.x, carriage.y), |r| r.aboard = Some(carriage.id.clone())),
            s.add("riding", (horse.x, horse.y), |r| r.riding = Some(horse.id.clone())),
            s.add("full-hands", home, |r| {
                r.carried = [(Good::Wood, carry_capacity(r, 0.0).floor())].into_iter().collect();
            }),
            s.add("own-script", far, |r| {
                r.script = Some(from(json!({ "scriptId": 101, "memory": {} })));
            }),
            s.add("defending", home, |r| {
                r.script = Some(from(json!({ "scriptId": 0, "task": "defend", "memory": {} })));
                r.interrupted =
                    Some(from(json!({ "order": serde_json::to_value(&drive).unwrap() })));
            }),
        ];
        let work = s.work_at();
        named.push(s.add("bare-worker", (s.farm.x, s.farm.y), |r| r.order = Some(work)));
        for (task, _, _) in DEFAULT_SCRIPTS {
            let name = serde_json::to_value(task).unwrap().as_str().unwrap().to_string();
            let city = city.clone();
            named.push(s.add(&format!("task-{name}"), home, |r| {
                let mut script = json!({ "scriptId": 0, "task": name, "memory": {} });
                // An Alarm script always has what it interrupted kept aside, and its alarm.
                if *task == Task::Alarm {
                    r.interrupted = Some(from(json!({ "order": null })));
                    script["alarm"] = json!({
                        "kind": "occupied", "cityId": city, "about": "nobody", "realmId": null,
                        "x": home.0, "y": home.1, "tick": 0
                    });
                }
                r.script = Some(from(script));
            }));
        }
        s.leader_dies();
        for _ in 0..2 * DAY {
            s.tick();
        }
        assert_eq!(messages(&s.world, s.terrain), Vec::<String>::new());
        let found: Vec<String> = named
            .iter()
            .flat_map(|id| {
                stuck(&s.world, s.terrain, &city, s.r(id))
                    .into_iter()
                    .map(move |p| format!("{id} {p}"))
            })
            .collect();
        assert_eq!(found, Vec::<String>::new());
    }

    #[test]
    fn an_armed_worker_on_a_bare_order_stands_as_a_soldier_leaving_their_place_to_others() {
        let mut s = realm_in_play();
        let work = s.work_at();
        let armed = s.add("armed", (s.farm.x, s.farm.y), |r| {
            r.carried = [(Good::Spear, 1.0), (Good::Food, 1.0)].into_iter().collect();
            r.order = Some(work);
        });
        assert!(is_armed(&s.r(&armed).carried));
        s.leader_dies();
        for _ in 0..70 {
            s.tick();
        }
        assert_eq!(job_kind(&s.world, &s.city, &armed).as_deref(), Some("soldier"));
        assert!(!matches!(s.r(&armed).order, Some(ResidentOrder::WorkAt(_))));
        assert!(s.r(&armed).script.is_none());
    }
}

/// A city's farmers left on bare orders, and one of its adults Carrying with their hands full
/// (`stuckVillage`).
fn stuck_village() -> Village {
    let mut v = village(None);
    for r in v.world.residents.iter_mut().skip(2) {
        r.script = None;
    }
    let c = &mut v.world.residents[0];
    (c.x, c.y) = (v.home.x, v.home.y);
    let cap = carry_capacity(c, v.world.tick as f64).floor();
    c.carried = [(Good::Wood, cap)].into_iter().collect();
    start_carrying(&mut v.world, 0, 1, 0.0);
    let si = storage_of(&v.world, &v.city);
    v.world.buildings[si].stock = Some(food(100.0));
    plan_city(&mut v.world, &v.city, Some(&v.terrain), None, None);
    v.world.tick += 2;
    v
}

fn kept_going(world: &WorldState) -> Vec<String> {
    npc_residents_kept_going(world).into_iter().flat_map(|v| v.entity_ids).collect()
}

mod residents_already_stuck_in_a_running_world {
    use super::*;

    #[test]
    fn get_going_again_by_the_next_tick_with_no_migration() {
        let Village { world, terrain, city, .. } = stuck_village();
        let crew: Vec<String> = world.residents.iter().skip(2).map(|r| r.id.clone()).collect();
        let carrier = world.residents[0].id.clone();
        let storage = world.buildings[storage_of(&world, &city)].id.clone();
        // As from a save.
        let mut saved: WorldState =
            serde_json::from_value(serde_json::to_value(&world).unwrap()).unwrap();
        assert!(npc_residents_kept_going(&saved).len() >= crew.len());
        let mut walking = Walking::new(Arc::new(terrain.clone()));
        step_world(&mut saved, &terrain, &mut Scratch::default(), Some(&mut walking), None);
        for id in &crew {
            let now = saved.residents.iter().find(|r| &r.id == id).unwrap();
            let s = now.script.as_ref().expect("a script");
            assert_eq!((s.script_id, s.task), (0, Some(Task::Work)), "{id}");
        }
        let c = saved.residents.iter().find(|r| r.id == carrier).unwrap();
        assert_eq!(c.carried.get(&Good::Wood).copied().unwrap_or(0.0), 0.0);
        let b = saved.buildings.iter().find(|b| b.id == storage).unwrap();
        assert!(b.stock.as_ref().and_then(|s| s.get(&Good::Wood)).copied().unwrap_or(0.0) > 0.0);
        assert_eq!(npc_residents_kept_going(&saved).len(), 0);
    }

    #[test]
    fn are_what_the_invariant_names_but_not_the_tick_a_resident_starts_carrying() {
        let Village { mut world, city, .. } = stuck_village();
        let mut want: Vec<String> = world.residents.iter().skip(2).map(|r| r.id.clone()).collect();
        let carrier = world.residents[0].id.clone();
        want.push(carrier.clone());
        want.sort();
        let mut ids = kept_going(&world);
        ids.sort();
        ids.dedup();
        assert_eq!(ids, want);
        let tick = world.tick as f64;
        world.residents[0].carrying.as_mut().unwrap().since = tick - 1.0;
        assert!(!kept_going(&world).contains(&carrier));
        // Before the city's first pass it hasn't had the chance to take them on.
        world.city_plans.shift_remove(&city);
        assert_eq!(kept_going(&world), Vec::<String>::new());
    }
}

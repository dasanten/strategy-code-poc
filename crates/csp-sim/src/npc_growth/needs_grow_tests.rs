//! `npc-needs-grow.test.ts`, one test per `it` (two for its `it.each`): needs grow with the city
//! (`CONTEXT.md`: NPC reserve, Spare hands' work, NPC road, NPC city; ADR 0029): the Wood and Stone
//! it keeps, its surplus caps, builders and road crew; a big city's second workplace; and farms
//! built only for the farmers it wants. The big city is `npc_slow`'s staged one (`bigCity()`).

use csp_shared::balance::{
    BUILD_MATERIALS, NPC_BUILDERS, NPC_RESIDENTS_PER_NEEDS_STEP, NPC_ROAD_CREW, NPC_SURPLUS_CAP,
    NPC_TOWN, NPC_TRADE, NPC_VILLAGE,
};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Building, BuildingKind, City, CityProject, Good, ResourceKind, Stock, TradeOrgCity, WorldState,
};
use serde_json::{json, Value};

use super::{farms_full, next_project, npc_builders};
use crate::npc_behaviour::npc_home;
use crate::npc_behaviour::npc_road_crew_sized;
use crate::npc_chain::SurplusWork;
use crate::npc_cities::found_npc_city;
use crate::npc_plan::{farmers_wanted, npc_surplus_capped, npc_workplaces_bounded, plan_city};
use crate::npc_roads::npc_road_crew;
use crate::npc_slow::add_node;
use crate::npc_slow::big_city_fixture::big_city;
use crate::npc_test_world::plains;
use crate::queries::building::max_workers;
use crate::queries::city::city_residents;
use crate::queries::names::held;
use crate::queries::npc_trade::{is_big_npc_city, npc_needs_scale, npc_reserve, npc_soldier_target};
use crate::queries::residents::can_work;
use crate::random::{new_id, Mulberry32};
use crate::world::create_world;

/// A city to test, with its home (its storage) and, for the big city, its lumber camp and quarry.
struct T {
    world: WorldState,
    terrain: TerrainMap,
    city: String,
    home: String,
    camp: String,
    quarry: String,
}

impl T {
    fn c(&self) -> &City {
        self.world.cities.iter().find(|c| c.id == self.city).unwrap()
    }

    fn c_mut(&mut self) -> &mut City {
        let id = self.city.clone();
        self.world.cities.iter_mut().find(|c| c.id == id).unwrap()
    }

    fn b(&self, id: &str) -> &Building {
        self.world.buildings.iter().find(|b| b.id == id).unwrap()
    }

    fn home(&self) -> &Building {
        self.b(&self.home)
    }

    fn stock(&mut self) -> &mut Stock {
        let id = self.home.clone();
        let home = self.world.buildings.iter_mut().find(|b| b.id == id).unwrap();
        home.stock.get_or_insert_with(Stock::new)
    }

    fn reserve(&self) -> Stock {
        npc_reserve(&self.world, self.c())
    }

    fn scale(&self) -> f64 {
        npc_needs_scale(&self.world, self.c())
    }

    fn residents(&self) -> Vec<String> {
        city_residents(&self.world, &self.city).iter().map(|r| r.id.clone()).collect()
    }

    fn r_index(&self, id: &str) -> usize {
        self.world.residents.iter().position(|r| r.id == id).unwrap()
    }

    /// The workplace a resident works by the Work default, if any.
    fn works_at(&self, id: &str) -> Option<String> {
        let r = &self.world.residents[self.r_index(id)];
        let place = r.script.as_ref()?.memory.get("workplaceId")?;
        place.as_str().map(str::to_string)
    }

    fn project(&self) -> Option<CityProject> {
        next_project(&self.world, self.c(), self.home(), &self.terrain)
    }

    /// What the next project builds, if it builds (`planned`).
    fn planned(&self) -> Option<BuildingKind> {
        match self.project() {
            Some(CityProject::Build { building, .. }) => Some(building),
            _ => None,
        }
    }

    fn surplus(&self, place: &str) -> Option<f64> {
        SurplusWork::of(&self.world, self.c(), Some(self.home())).full(&self.world, self.b(place))
    }

    /// A free node of `kind` the city knows of, near its home (`freeNode`).
    fn free_node(&mut self, kind: ResourceKind, dx: f64) -> (f64, f64) {
        let at = (self.home().x + dx, self.home().y + 30.0);
        add_node(&mut self.world, &mut self.terrain, kind, at.0, at.1);
        at
    }

    /// Arms as many as the city keeps as soldiers, so its reserve wants no Wood for their weapons
    /// (`armAll`).
    fn arm_all(&mut self) {
        let tick = self.world.tick as f64;
        let adults: Vec<String> = city_residents(&self.world, &self.city)
            .iter()
            .filter(|r| can_work(r.born_at, tick))
            .map(|r| r.id.clone())
            .collect();
        for id in adults.iter().take(npc_soldier_target(adults.len() as f64) as usize) {
            let i = self.r_index(id);
            self.world.residents[i].carried.insert(Good::Spear, 1.0);
        }
    }

    /// A finished lumber camp of the city at a tile (`standingCamp`).
    fn standing_camp(&mut self, at: (f64, f64)) -> String {
        let id = new_id("b", &mut self.world.next_id);
        let camp = crate::test_support::building(&id, BuildingKind::LumberCamp, None, at.0, at.1);
        self.world.buildings.push(camp);
        self.c_mut().workplace_ids.get_or_insert_with(Vec::new).push(id.clone());
        id
    }

    /// Fills a workplace's crew, by the Work default, from those not already at one
    /// (`fillCrew`).
    fn fill_crew(&mut self, place: &str) {
        let tick = self.world.tick as f64;
        let kind = self.b(place).kind;
        let free: Vec<String> = self
            .residents()
            .into_iter()
            .filter(|id| {
                let r = &self.world.residents[self.r_index(id)];
                can_work(r.born_at, tick) && self.works_at(id).is_none()
            })
            .collect();
        for id in free.iter().take(max_workers(kind).unwrap_or(0.0) as usize) {
            let i = self.r_index(id);
            self.world.residents[i].script = Some(from(
                json!({ "scriptId": 0, "task": "work", "memory": { "workplaceId": place } }),
            ));
        }
    }

    /// One free to work the last pass left idle (`idle`).
    fn idle(&mut self) -> String {
        let tick = self.world.tick as f64;
        let id = self
            .residents()
            .into_iter()
            .find(|id| {
                let r = &self.world.residents[self.r_index(id)];
                can_work(r.born_at, tick) && r.script.is_none()
            })
            .unwrap();
        self.set_plan(json!({ "plannedAt": tick, "jobs": { id.clone(): { "kind": "idle" } } }));
        id
    }

    fn set_plan(&mut self, plan: Value) {
        self.world.city_plans.insert(self.city.clone(), from(plan));
    }

    fn first(&self, kind: BuildingKind) -> String {
        self.world.buildings.iter().find(|b| b.kind == kind).unwrap().id.clone()
    }

    fn crew(&self, place: &str) -> Vec<String> {
        self.residents().into_iter().filter(|id| self.works_at(id).as_deref() == Some(place)).collect()
    }
}

fn from<T: serde::de::DeserializeOwned>(v: Value) -> T {
    serde_json::from_value(v).unwrap()
}

fn wood_of(kind: &str) -> f64 {
    BUILD_MATERIALS.get(kind).and_then(|m| m.get("wood")).unwrap_or(0.0)
}

fn cap(good: &str) -> f64 {
    NPC_SURPLUS_CAP.get(good).unwrap_or(0.0)
}

fn close_to(a: Option<f64>, b: f64) -> bool {
    a.is_some_and(|a| (a - b).abs() < 0.005)
}

/// A big city, every good it wants at its reserve and the rest empty past that (`big`).
fn big() -> T {
    let s = big_city(None, 240);
    let mut t = T {
        world: s.world,
        terrain: s.terrain,
        city: s.city,
        home: s.home,
        camp: String::new(),
        quarry: String::new(),
    };
    *t.stock() = t.reserve();
    t.camp = t.first(BuildingKind::LumberCamp);
    t.quarry = t.first(BuildingKind::Quarry);
    t
}

fn npc_city(kind: &csp_shared::balance::NpcCitySize) -> T {
    let terrain = plains(240);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(3.0);
    let city = found_npc_city(&mut world, &terrain, kind, 60, 60, &mut || m.next(), None);
    let home = npc_home(&world, &city).unwrap().id.clone();
    T { world, terrain, city, home, camp: String::new(), quarry: String::new() }
}

// a village

/// A village with everyone it keeps as soldiers armed (`village`).
fn village() -> T {
    let mut t = npc_city(&NPC_VILLAGE);
    t.arm_all();
    t
}

#[test]
fn keeps_a_village_number_of_everything() {
    let mut t = village();
    let reserve = t.reserve();
    assert_eq!(t.scale(), 1.0);
    assert!(!is_big_npc_city(&t.world, t.c()));
    let wood = wood_of("house") + wood_of("wall") * NPC_TRADE.reserve_wall_stretches;
    assert_eq!(reserve.get(&Good::Wood).copied(), Some(wood));
    assert_eq!(reserve.get(&Good::Stone), None);
    assert_eq!(npc_builders(&t.world, t.c()), NPC_BUILDERS);
    assert_eq!(npc_road_crew(&t.world, t.c()), NPC_ROAD_CREW);
    let at = t.free_node(ResourceKind::Forest, 20.0);
    let camp = t.standing_camp(at);
    let mut stock = reserve.clone();
    stock.insert(Good::Wood, held(&reserve, Good::Wood) + cap("wood") / 2.0);
    *t.stock() = stock;
    assert!(close_to(t.surplus(&camp), 0.5), "{:?}", t.surplus(&camp));
}

#[test]
fn and_so_does_a_town() {
    let t = npc_city(&NPC_TOWN);
    assert_eq!(t.scale(), 1.0);
    assert_eq!(npc_road_crew(&t.world, t.c()), NPC_ROAD_CREW);
    assert_eq!(t.reserve().get(&Good::Stone), None);
}

// a big city

#[test]
fn counts_whole_steps_of_its_residents() {
    let t = big();
    let steps = (t.residents().len() as f64 / NPC_RESIDENTS_PER_NEEDS_STEP).floor();
    assert!(steps > 1.0);
    assert_eq!(t.scale(), steps);
    assert!(is_big_npc_city(&t.world, t.c()));
}

#[test]
fn keeps_more_wood_and_stone_by_the_step() {
    let t = big();
    let steps = t.scale();
    let wood = wood_of("house") + wood_of("wall") * NPC_TRADE.reserve_wall_stretches;
    let reserve = t.reserve();
    // Wood for the weapons it hasn't armed yet comes on top, and it has armed all it keeps.
    assert_eq!(held(&reserve, Good::Wood), wood * steps);
    assert_eq!(held(&reserve, Good::Stone), NPC_TRADE.reserve_stone_per_step * (steps - 1.0));
}

#[test]
fn has_more_builders_and_a_bigger_road_crew_by_the_step() {
    let t = big();
    let steps = t.scale();
    assert_eq!(npc_builders(&t.world, t.c()), NPC_BUILDERS * steps);
    assert_eq!(npc_road_crew(&t.world, t.c()), NPC_ROAD_CREW * steps);
}

#[test]
fn works_for_surplus_up_to_a_cap_by_the_step() {
    let mut t = big();
    let cap = cap("wood") * t.scale();
    let reserve = held(&t.reserve(), Good::Wood);
    t.stock().insert(Good::Wood, reserve + cap / 2.0);
    let camp = t.camp.clone();
    assert!(close_to(t.surplus(&camp), 0.5), "{:?}", t.surplus(&camp));
    t.stock().insert(Good::Wood, reserve + cap);
    assert_eq!(t.surplus(&camp), None);
}

// a second workplace

/// A big city with nothing short, its lumber camp's crew full and Wood below its cap (`ready`),
/// and the free forest it would open a second camp on.
fn ready() -> (T, (f64, f64)) {
    let mut t = big();
    // A stable stands, or it wants one first once nothing is short.
    let (hx, hy) = (t.home().x, t.home().y);
    let id = new_id("b", &mut t.world.next_id);
    let stable =
        crate::test_support::building(&id, BuildingKind::Stable, Some(&t.city), hx - 9.0, hy - 9.0);
    t.world.buildings.push(stable);
    let reserve = t.reserve();
    let mut stock = reserve.clone();
    // Stone at its cap, so only Wood wants a second workplace.
    stock.insert(Good::Stone, held(&reserve, Good::Stone) + cap("stone") * t.scale());
    *t.stock() = stock;
    let camp = t.camp.clone();
    t.fill_crew(&camp);
    let at = t.free_node(ResourceKind::Forest, 20.0);
    (t, at)
}

fn opens_camp(t: &T) -> bool {
    t.planned() == Some(BuildingKind::LumberCamp)
}

#[test]
fn opens_with_the_first_crew_full_and_its_good_below_the_cap() {
    let (t, at) = ready();
    assert_eq!(
        t.project(),
        Some(CityProject::Build { building: BuildingKind::LumberCamp, x: at.0, y: at.1 })
    );
}

#[test]
fn does_not_open_with_room_in_the_first_crew() {
    let (mut t, _) = ready();
    let worker = t.crew(&t.camp.clone())[0].clone();
    let i = t.r_index(&worker);
    t.world.residents[i].script = None;
    assert!(!opens_camp(&t));
}

#[test]
fn does_not_open_with_its_good_at_the_cap() {
    let (mut t, _) = ready();
    let reserve = held(&t.reserve(), Good::Wood);
    let full = reserve + cap("wood") * t.scale();
    t.stock().insert(Good::Wood, full);
    assert!(!opens_camp(&t));
}

#[test]
fn does_not_open_with_something_short() {
    let (mut t, _) = ready();
    t.stock().insert(Good::Stone, 0.0);
    assert!(!opens_camp(&t));
}

#[test]
fn opens_no_third() {
    let (mut t, at) = ready();
    let second = t.standing_camp(at);
    t.fill_crew(&second);
    t.free_node(ResourceKind::Forest, 26.0);
    assert!(!opens_camp(&t));
}

#[test]
fn does_not_open_in_a_small_city() {
    let (mut t, _) = ready();
    // Everyone but the camp's crew and a few moved out: it's back to a village's numbers.
    let crew = t.crew(&t.camp.clone());
    let people = t.residents();
    let mut left = people.len();
    for id in &people {
        if crew.contains(id) || (left as f64) < 2.0 * NPC_RESIDENTS_PER_NEEDS_STEP {
            continue;
        }
        let i = t.r_index(id);
        t.world.residents[i].city_id = None;
        left -= 1;
    }
    assert!(!is_big_npc_city(&t.world, t.c()));
    let mut stock = t.reserve();
    stock.insert(Good::Stone, 10_000.0);
    *t.stock() = stock;
    assert!(!opens_camp(&t));
}

// farms

/// A big city with `farms` farms, the rest of its farms taken away (`withFarms`).
fn with_farms(farms: usize) -> (T, Vec<String>) {
    let mut t = big();
    let own: Vec<String> = t
        .world
        .buildings
        .iter()
        .filter(|b| b.kind == BuildingKind::Farm && b.city_id.as_deref() == Some(t.city.as_str()))
        .map(|b| b.id.clone())
        .collect();
    let gone = &own[farms.min(own.len())..];
    t.world.buildings.retain(|b| !gone.contains(&b.id));
    (t, own[..farms.min(own.len())].to_vec())
}

#[test]
fn stop_growing_past_what_its_farmers_need_however_full_spare_hands_keep_them() {
    let per = max_workers(BuildingKind::Farm).unwrap_or(0.0);
    let whole = big_city(None, 240);
    let c = whole.world.cities.iter().find(|c| c.id == whole.city).unwrap();
    let farms = (farmers_wanted(&whole.world, c) / per).ceil() as usize;
    let (mut t, own) = with_farms(farms);
    for farm in &own {
        t.fill_crew(farm);
    }
    assert_ne!(t.planned(), Some(BuildingKind::Farm));
}

#[test]
fn grow_when_the_farmers_it_wants_do_not_fit() {
    let (t, _) = with_farms(1);
    assert!(farmers_wanted(&t.world, t.c()) > max_workers(BuildingKind::Farm).unwrap_or(0.0));
    assert_eq!(t.planned(), Some(BuildingKind::Farm));
}

// invariants

/// A plan giving `n` of the city's residents the road (`crewPlan`).
fn crew_plan(t: &T, n: usize) -> Value {
    let jobs: serde_json::Map<String, Value> =
        t.residents().into_iter().take(n).map(|id| (id, json!({ "kind": "road" }))).collect();
    json!({ "plannedAt": t.world.tick, "jobs": jobs })
}

#[test]
fn let_a_big_city_have_a_bigger_road_crew_up_to_its_size() {
    let mut t = big();
    let most = npc_road_crew(&t.world, t.c());
    assert!(most > NPC_ROAD_CREW);
    let plan = crew_plan(&t, most as usize);
    t.set_plan(plan);
    assert_eq!(npc_road_crew_sized(&t.world), vec![]);
    let plan = crew_plan(&t, most as usize + 1);
    t.set_plan(plan);
    assert_eq!(npc_road_crew_sized(&t.world).len(), 1);
}

#[test]
fn hold_a_big_city_to_its_bigger_surplus_cap() {
    let mut t = big();
    let cap = cap("wood") * t.scale();
    let reserve = held(&t.reserve(), Good::Wood);
    let r = t.residents()[0].clone();
    let camp = t.camp.clone();
    let tick = t.world.tick;
    t.set_plan(json!({
        "plannedAt": tick, "jobs": { r: { "kind": "work", "buildingId": camp } },
    }));
    t.stock().insert(Good::Wood, reserve + 2.0 * cap - 1.0);
    assert_eq!(npc_surplus_capped(&t.world), vec![]);
    t.stock().insert(Good::Wood, reserve + 2.0 * cap);
    assert_eq!(npc_surplus_capped(&t.world).len(), 1);
}

/// A plan whose project is a lumber camp at `at` (`planned`).
fn camp_planned(t: &mut T, at: (f64, f64)) {
    let tick = t.world.tick;
    t.set_plan(json!({
        "plannedAt": tick, "jobs": {},
        "project": { "kind": "build", "building": "lumberCamp", "x": at.0, "y": at.1 },
    }));
}

#[test]
fn let_a_big_city_plan_its_second() {
    let mut t = big();
    let at = t.free_node(ResourceKind::Forest, 20.0);
    camp_planned(&mut t, at);
    assert_eq!(npc_workplaces_bounded(&t.world), vec![]);
}

#[test]
fn find_a_big_city_planning_a_third_with_its_good_not_short() {
    let mut t = big();
    let standing = t.free_node(ResourceKind::Forest, 20.0);
    t.standing_camp(standing);
    let third = t.free_node(ResourceKind::Forest, 26.0);
    camp_planned(&mut t, third);
    t.stock().insert(Good::Wood, 5000.0);
    assert_eq!(npc_workplaces_bounded(&t.world).len(), 1);
    // Short of it, a third is what idle hands call for.
    t.stock().insert(Good::Wood, 0.0);
    assert_eq!(npc_workplaces_bounded(&t.world), vec![]);
}

#[test]
fn find_a_farm_planned_with_its_farmers_fitting_and_food_not_short() {
    let mut t = big();
    let (hx, hy) = (t.home().x, t.home().y);
    let tick = t.world.tick;
    t.set_plan(json!({
        "plannedAt": tick, "jobs": {},
        "project": { "kind": "build", "building": "farm", "x": hx + 50.0, "y": hy + 50.0 },
    }));
    t.stock().insert(Good::Food, 5000.0);
    assert_eq!(npc_workplaces_bounded(&t.world).len(), 1);
    t.stock().insert(Good::Food, 0.0);
    assert_eq!(npc_workplaces_bounded(&t.world), vec![]);
}

#[test]
fn find_a_village_planning_a_second() {
    let mut t = npc_city(&NPC_VILLAGE);
    let first = t.free_node(ResourceKind::Forest, 20.0);
    t.standing_camp(first);
    let second = t.free_node(ResourceKind::Forest, 26.0);
    camp_planned(&mut t, second);
    t.stock().insert(Good::Wood, 5000.0);
    assert_eq!(npc_workplaces_bounded(&t.world).len(), 1);
}

// a short good with its workplaces full (CONTEXT.md: NPC city)

/// The big city with just `farms` farms, all full, Food a little short of its reserve
/// (`fullFarms`).
fn full_farms(farms: usize) -> (T, Vec<String>) {
    let (mut t, own) = with_farms(farms);
    let food = held(t.stock(), Good::Food) - 1.0;
    t.stock().insert(Good::Food, food);
    for farm in &own {
        t.fill_crew(farm);
    }
    (t, own)
}

#[test]
fn opens_another_farm_for_those_it_has_idle() {
    let (mut t, _) = full_farms(3);
    t.idle();
    assert_eq!(t.planned(), Some(BuildingKind::Farm));
}

#[test]
fn counts_a_carrier_home_between_trips_as_holding_their_place() {
    let (mut t, farms) = full_farms(3);
    let r = t.idle();
    let farm = farms[0].clone();
    let crew = t.crew(&farm);
    let plan = t.world.city_plans.get_mut(&t.city).unwrap();
    for x in &crew {
        plan.jobs.insert(x.clone(), from(json!({ "kind": "farm", "buildingId": farm })));
    }
    let i = t.r_index(&crew[0]);
    t.world.residents[i].script = None;
    let kind = serde_json::to_value(&t.world.city_plans[&t.city].jobs[&r]).unwrap();
    assert_eq!(kind["kind"], "idle");
    assert_eq!(t.planned(), Some(BuildingKind::Farm));
}

#[test]
fn opens_another_farm_for_food_with_nobody_idle_995() {
    let (mut t, _) = full_farms(3);
    assert_eq!(t.planned(), Some(BuildingKind::Farm));
    let r = t.idle();
    let tick = t.world.tick;
    let i = t.r_index(&r);
    let base = json!({ "strength": 10, "endurance": 10, "agility": 10, "intellect": 10 });
    t.world.residents[i].carrying = Some(from(json!({
        "partnerId": "nobody", "partnerName": "nobody", "partnerBase": base, "since": tick,
    })));
    assert_eq!(t.planned(), Some(BuildingKind::Farm));
    assert_eq!(npc_workplaces_bounded(&t.world), vec![]);
}

#[test]
fn finishes_a_farm_already_begun_before_it_opens_another() {
    let (mut t, _) = full_farms(3);
    let id = new_id("b", &mut t.world.next_id);
    let (x, y) = (t.home().x, t.home().y - 40.0);
    let begun: Building = from(json!({
        "id": id, "kind": "farm", "cityId": t.city, "x": x, "y": y,
        "site": { "delivered": {}, "work": 0 },
    }));
    t.world.buildings.push(begun);
    assert_eq!(t.project(), Some(CityProject::Build { building: BuildingKind::Farm, x, y }));
}

/// The big city with three full farms and a fourth just finished, its lumber camp full and Wood
/// short, its quarry working for surplus, and every other adult free to work out scouting
/// (`newFarm`). Answers the fourth farm, the scouts, and the camp's and quarry's crews.
struct NewFarm {
    t: T,
    fourth: String,
    scouts: Vec<String>,
    camp_crew: Vec<String>,
    quarry_crew: Vec<String>,
}

fn new_farm(food: impl Fn(f64) -> f64) -> NewFarm {
    let (mut t, _) = full_farms(3);
    let reserve = t.reserve();
    let fourth = new_id("b", &mut t.world.next_id);
    let (x, y) = (t.home().x, t.home().y - 40.0);
    let b = crate::test_support::building(&fourth, BuildingKind::Farm, Some(&t.city), x, y);
    t.world.buildings.push(b);
    let stock = t.stock();
    stock.insert(Good::Food, food(held(&reserve, Good::Food)));
    stock.insert(Good::Wood, (held(&reserve, Good::Wood) / 2.0).floor());
    let (camp, quarry) = (t.camp.clone(), t.quarry.clone());
    t.fill_crew(&camp);
    t.fill_crew(&quarry);
    let tick = t.world.tick as f64;
    let scouts: Vec<String> = t
        .residents()
        .into_iter()
        .filter(|id| {
            let r = &t.world.residents[t.r_index(id)];
            can_work(r.born_at, tick) && r.script.is_none() && !r.carried.contains_key(&Good::Spear)
        })
        .collect();
    let trips: serde_json::Map<String, Value> =
        scouts.iter().map(|id| (id.clone(), json!({ "saw": [] }))).collect();
    t.set_plan(json!({ "plannedAt": t.world.tick, "jobs": {}, "scouts": trips }));
    let camp_crew = t.crew(&camp);
    let quarry_crew = t.crew(&quarry);
    NewFarm { t, fourth, scouts, camp_crew, quarry_crew }
}

fn takes_the_new_farms_farmers_from_surplus_work_and_scouts_first(food: impl Fn(f64) -> f64) {
    let NewFarm { mut t, fourth, scouts, camp_crew, quarry_crew } = new_farm(food);
    let terrain = t.terrain.clone();
    plan_city(&mut t.world, &t.city, Some(&terrain), None, None);
    let jobs = &t.world.city_plans[&t.city].jobs;
    let there: Vec<&String> = jobs
        .iter()
        .filter(|(_, j)| j.building_id.as_deref() == Some(fourth.as_str()))
        .map(|(id, _)| id)
        .collect();
    assert_eq!(there.len(), max_workers(BuildingKind::Farm).unwrap_or(0.0) as usize);
    for id in there {
        assert!(quarry_crew.contains(id) || scouts.contains(id), "{id}");
    }
    // Those making a short good stay at it.
    assert!(!camp_crew.is_empty());
    for id in &camp_crew {
        assert_eq!(jobs[id].building_id.as_deref(), Some(t.camp.as_str()), "{id}");
    }
}

#[test]
fn takes_the_new_farms_farmers_from_surplus_work_and_scouts_first_food_short_of_its_reserve() {
    takes_the_new_farms_farmers_from_surplus_work_and_scouts_first(|reserve| reserve - 1.0);
}

#[test]
fn takes_the_new_farms_farmers_from_surplus_work_and_scouts_first_food_running_short() {
    takes_the_new_farms_farmers_from_surplus_work_and_scouts_first(|_| 1.0);
}

#[test]
fn opens_none_while_a_farm_has_room_or_with_food_not_short() {
    let (mut room, farms) = full_farms(3);
    room.idle();
    let worker = room.crew(&farms[0])[0].clone();
    let i = room.r_index(&worker);
    room.world.residents[i].script = None;
    assert_ne!(room.planned(), Some(BuildingKind::Farm));

    let (mut fed, _) = full_farms(3);
    fed.idle();
    fed.stock().insert(Good::Food, 5000.0);
    assert_ne!(fed.planned(), Some(BuildingKind::Farm));
}

/// The project of a fresh planning pass.
fn plan_project(t: &mut T) -> Option<CityProject> {
    let terrain = t.terrain.clone();
    plan_city(&mut t.world, &t.city, Some(&terrain), None, None);
    t.world.city_plans[&t.city].project.clone()
}

#[test]
fn opens_a_farm_even_as_food_runs_short_nobody_idle_but_nothing_else() {
    let (mut t, _) = full_farms(3);
    t.stock().insert(Good::Food, 1.0);
    assert!(farms_full(&t.world, t.c()));
    let p = plan_project(&mut t);
    assert!(matches!(p, Some(CityProject::Build { building: BuildingKind::Farm, .. })), "{p:?}");
    // With a farm's place free, Food running short builds nothing.
    let (mut fresh, farms) = full_farms(3);
    fresh.stock().insert(Good::Food, 1.0);
    let worker = fresh.crew(&farms[0])[0].clone();
    let i = fresh.r_index(&worker);
    fresh.world.residents[i].script = None;
    assert_eq!(plan_project(&mut fresh), None);
}

#[test]
fn opens_a_third_lumber_camp_with_two_full_and_wood_short() {
    let mut t = big();
    t.stock().insert(Good::Wood, 1.0);
    let at = t.free_node(ResourceKind::Forest, 20.0);
    let second = t.standing_camp(at);
    t.free_node(ResourceKind::Forest, 26.0);
    let camp = t.camp.clone();
    t.fill_crew(&camp);
    t.fill_crew(&second);
    assert_ne!(t.planned(), Some(BuildingKind::LumberCamp));
    t.idle();
    assert_eq!(t.planned(), Some(BuildingKind::LumberCamp));
    assert_eq!(npc_workplaces_bounded(&t.world), vec![]);
}

#[test]
fn opens_another_of_what_makes_the_input_it_lacks_or_of_what_processes_one_it_holds() {
    let mut t = big();
    let mine = t.first(BuildingKind::Mine);
    let smelter = t.first(BuildingKind::Smelter);
    let armed: Vec<String> = t
        .residents()
        .into_iter()
        .filter(|id| t.world.residents[t.r_index(id)].carried.contains_key(&Good::Spear))
        .collect();
    for id in armed.iter().take(4) {
        let i = t.r_index(id);
        t.world.residents[i].carried.shift_remove(&Good::Spear);
    }
    let mut stock = t.reserve();
    stock.insert(Good::Iron, 0.0);
    stock.insert(Good::IronOre, 0.0);
    stock.insert(Good::Spear, 0.0);
    *t.stock() = stock;
    t.fill_crew(&mine);
    t.idle();
    assert_eq!(t.planned(), Some(BuildingKind::Mine));

    t.stock().insert(Good::IronOre, 500.0);
    t.fill_crew(&smelter);
    t.idle();
    assert_eq!(t.planned(), Some(BuildingKind::Smelter));
}

#[test]
fn leaves_a_trade_org_city_out_of_it() {
    let (mut t, _) = full_farms(3);
    t.idle();
    t.c_mut().trade_org = Some(TradeOrgCity::Post);
    assert!(!farms_full(&t.world, t.c()));
}

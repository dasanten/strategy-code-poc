//! How a city the game runs thinks (`apps/server/src/npc-plan.ts`, `CONTEXT.md`: NPC city;
//! ADR 0016): once a game hour (`NPC_PLAN_TICKS`), staggered by its id, a planning pass decides
//! everything that takes thought and keeps the result in the city's plan
//! (`WorldState.city_plans`): pairs, the next project, and a job for every adult. Between passes the
//! city only hands idle residents their planned job, and a worker stays where the plan put them
//! until the next pass moves them.

use std::collections::{HashMap, HashSet};

use csp_shared::balance::{
    FOOD_PER_DAY, MAP_SIZE, NPC_FOOD_SHORT_DAYS, NPC_PLAN_TICKS, WORK_OUTPUT_PER_DAY,
};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Building, BuildingKind, City, CityJob, CityJobKind, CityPlan, CityProject, Good, ResidentOrder,
    WorldState,
};
use indexmap::IndexMap;

use crate::npc_behaviour::{npc_home, workplace_of, Jobs};
use crate::npc_chain::{
    chain_good, chain_input, chain_store_index, holds_batch, shortages, SurplusWork,
};
use crate::npc_founding::{founding_party, plan_founding, FoundingPeople};
use crate::npc_growth::{
    city_grows, city_project, end_pairs, farms_full, is_builder, no_farm, npc_builders, pair_adults,
};
use crate::npc_revive::{down_to_revive, goes_on_reviving, send_revivers};
use crate::npc_roads::{road_crew, WayFinder};
use crate::npc_scores::{beats, job_score, rank_jobs, ScoredJob};
use crate::npc_scouts::pick_scouts;
use crate::npc_stable::{feed_job_kept, plan_feeder};
use crate::npc_trader::{send_traders, traders_out};
use crate::npc_training::plan_training;
use crate::queries::alliance::contract_of;
use crate::queries::building::{building_at, materials_needed, max_workers, workplace_good};
use crate::queries::city::{city_food_use, city_residents, has_food_surplus, stored_food};
use crate::queries::names::{held, held_in};
use crate::queries::npc_trade::npc_storages;
use crate::queries::residents::{can_work, is_armed};
use crate::random::hash_str;
use crate::sight::InvariantViolation;

/// A job with its kind and building, if it has one.
fn job_at(kind: CityJobKind, building_id: Option<&str>) -> CityJob {
    CityJob {
        kind,
        building_id: building_id.map(str::to_string),
        target_id: None,
        stable_id: None,
        ground_id: None,
        subject: None,
    }
}

/// Whether a city's planning pass is due this tick (`planDue`): once every `NPC_PLAN_TICKS`,
/// staggered by id.
pub fn plan_due(world: &WorldState, city_id: &str) -> bool {
    (world.tick as f64 + f64::from(hash_str(city_id))) % NPC_PLAN_TICKS == 0.0
}

/// The residents each city the game runs gives orders to, by city id (`runResidents`): those living
/// there who belong to no realm, except a caravan's crew, a hired-out resident and a punisher. Those
/// three don't go on with the city's Work default either.
pub fn run_residents(world: &mut WorldState) -> IndexMap<String, Vec<usize>> {
    let (out, away) = runners(world);
    for i in away {
        if world.residents[i].script.as_ref().is_some_and(|s| s.script_id == 0) {
            world.residents[i].script = None;
        }
    }
    out
}

/// What [`run_residents`] finds without changing the world: the residents each city runs, and
/// those of its people away on other business, whose Work default it ends. The invariants read it
/// (`runResidents` in a TypeScript invariant also ends those defaults; the step does that anyway).
pub fn runners(world: &WorldState) -> (IndexMap<String, Vec<usize>>, Vec<usize>) {
    // `caravanCrew` (T86.9) and `punishers` (T86.9): who is away on the Trade Org's business.
    let mut away: HashSet<String> = world
        .caravans
        .iter()
        .flat_map(|c| c.driver_id.iter().chain(&c.escort_ids))
        .chain(world.traders.iter().flat_map(|t| t.driver_id.iter().chain(&t.escort_ids)))
        .cloned()
        .collect();
    away.extend(
        world.punishments.iter().flat_map(|p| p.members.iter().map(|m| m.resident_id.clone())),
    );
    away.extend(world.supply_wagons.iter().filter_map(|w| w.driver_id.clone()));
    let mut out: IndexMap<String, Vec<usize>> = IndexMap::new();
    let mut gone = Vec::new();
    for (i, r) in world.residents.iter().enumerate() {
        let Some(city) = r.city_id.clone() else { continue };
        if r.owner.is_some() {
            continue;
        }
        if away.contains(&r.id) || contract_of(world, &r.id).is_some() {
            gone.push(i);
            continue;
        }
        out.entry(city).or_default().push(i);
    }
    (out, gone)
}

/// Whether a city's Food runs short (`foodShort`): its storages hold less than its residents eat
/// in `NPC_FOOD_SHORT_DAYS`. An NPC city with no storage yet is never short.
pub fn food_short(world: &WorldState, city: &City) -> bool {
    if city.trade_org.is_none() && npc_storages(world, city).is_empty() {
        return false;
    }
    stored_food(world, city) < city_food_use(world, city, NPC_FOOD_SHORT_DAYS)
}

/// The city's finished workplaces that make something from nothing (`workplaces`), its farms and
/// those in its `workplaceIds`, in the order it fills them: farms first until the city has a food
/// surplus, else last.
pub fn workplaces(world: &WorldState, city: &City) -> Vec<usize> {
    let farms_first = !has_food_surplus(world, city);
    let own: HashSet<&String> = city.workplace_ids.iter().flatten().collect();
    let mut places: Vec<usize> = world
        .buildings
        .iter()
        .enumerate()
        .filter(|(_, b)| {
            (b.city_id.as_ref() == Some(&city.id) || own.contains(&b.id))
                && b.site.is_none()
                && max_workers(b.kind).is_some()
                && csp_shared::balance::RECIPES
                    .get(crate::queries::names::kind_name(b.kind))
                    .is_none()
                && workplace_good(world, b, None).is_some()
        })
        .map(|(i, _)| i)
        .collect();
    let farm = |i: &usize| if world.buildings[*i].kind == BuildingKind::Farm { 0 } else { 1 };
    places.sort_by(|a, b| if farms_first { farm(a).cmp(&farm(b)) } else { farm(b).cmp(&farm(a)) });
    places
}

/// Who holds the places at the city's workplaces (`Places`), from its residents indexed once.
pub struct Places {
    by_workplace: HashMap<String, i64>,
    by_tile: HashMap<(i64, i64), i64>,
}

impl Places {
    /// Counts `people` once (`new Places(people)`).
    pub fn new(world: &WorldState, people: &[usize]) -> Self {
        let mut by_workplace = HashMap::new();
        let mut by_tile = HashMap::new();
        for &i in people {
            let r = &world.residents[i];
            let id = workplace_of(r);
            if let Some(id) = &id {
                *by_workplace.entry(id.clone()).or_insert(0) += 1;
            }
            // One working it by the Work default and walking back to its tile holds one place.
            if id.is_none() {
                if let Some(ResidentOrder::WalkTo(o)) = &r.order {
                    *by_tile.entry((o.target.x as i64, o.target.y as i64)).or_insert(0) += 1;
                }
            }
        }
        Places { by_workplace, by_tile }
    }

    /// Places taken at a workplace (`taken`).
    pub fn taken(&self, place: &Building) -> i64 {
        self.by_workplace.get(&place.id).copied().unwrap_or(0)
            + self.by_tile.get(&(place.x as i64, place.y as i64)).copied().unwrap_or(0)
    }

    /// Room left at a workplace (`room`).
    pub fn room(&self, place: &Building) -> f64 {
        max_workers(place.kind).unwrap_or(0.0) - self.taken(place) as f64
    }

    /// One more resident is going to a workplace (`take`).
    pub fn take(&mut self, place: &Building) {
        *self.by_workplace.entry(place.id.clone()).or_insert(0) += 1;
    }

    /// A resident left a workplace (`leave`).
    pub fn leave(&mut self, place: &Building) {
        *self.by_workplace.entry(place.id.clone()).or_insert(0) -= 1;
    }
}

/// A city's planning pass (`planCity`, `CONTEXT.md`: NPC city; ADR 0016): makes or remakes its plan
/// from what it has now. `people` are the residents the city gives orders to (`runResidents`).
pub fn plan_city(
    world: &mut WorldState,
    city_id: &str,
    terrain: Option<&TerrainMap>,
    people: Option<Vec<usize>>,
    mut ways: Option<&mut dyn WayFinder>,
) {
    let tick = world.tick as f64;
    let people = match people {
        Some(p) => p,
        None => run_residents(world).shift_remove(city_id).unwrap_or_default(),
    };
    let plan = world.city_plans.entry(city_id.to_string()).or_insert_with(|| CityPlan {
        planned_at: tick,
        jobs: IndexMap::new(),
        project: None,
        roads: None,
        streets: None,
        traders: None,
        full_since: None,
        short_since: None,
        founding_site: None,
        scouts: None,
        patrols: None,
        patrolled_last: None,
    });
    plan.planned_at = tick;
    let Some(city) = world.cities.iter().find(|c| c.id == city_id).cloned() else { return };
    // A founding party out is the founding's business, not shared out.
    let party: HashSet<String> =
        founding_party(world.city_plans.get(city_id)).into_iter().collect();
    let members: Vec<usize> =
        people.iter().copied().filter(|&i| party.contains(&world.residents[i].id)).collect();
    let adults: Vec<usize> = people
        .iter()
        .copied()
        .filter(|&i| {
            let r = &world.residents[i];
            can_work(r.born_at, tick) && r.down_until.is_none() && !party.contains(&r.id)
        })
        .collect();
    let short = food_short(world, &city);
    let grows = city_grows(world, &city, &adults);
    if grows {
        if short {
            end_pairs(world, &adults);
        } else {
            pair_adults(world, &city, &adults);
        }
    }
    let home = npc_home(world, city_id).cloned();
    // With Food short it builds nothing but what ends that: a first farm, or another with every
    // farm full.
    let project = match (terrain, &home) {
        (Some(t), Some(h)) if !short || no_farm(world, &city) || farms_full(world, &city) => {
            city_project(world, &city, h, t, grows)
        }
        _ => None,
    };
    world.city_plans.get_mut(city_id).expect("a plan").project = project;

    let places = workplaces(world, &city);
    let place_ids: HashSet<String> =
        places.iter().map(|&b| world.buildings[b].id.clone()).collect();
    let mut held = Places::new(world, &people);
    let mut jobs: Jobs = IndexMap::new();
    let old_jobs = world.city_plans[city_id].jobs.clone();
    // The road crew is apart from its builders, and spare hands.
    let builds = |world: &WorldState, i: usize| {
        is_builder(&world.residents[i])
            && old_jobs.get(&world.residents[i].id).is_none_or(|j| j.kind != CityJobKind::Road)
    };
    let builders = adults.iter().filter(|&&i| builds(world, i)).count() as f64;
    let mut spare: Vec<usize> = Vec::new();
    // A trader out on their run is nobody's spare hand.
    let traders =
        if city.trade_org.is_some() { HashSet::new() } else { traders_out(world, city_id) };
    let size = terrain.map_or(MAP_SIZE, |t| t.size);
    let mut waiting = down_to_revive(world, &city, size);
    let mut feeding = false;
    for &i in &adults {
        let r = &world.residents[i];
        let id = r.id.clone();
        let at = workplace_of(r);
        let feed = feed_job_kept(world, &city, r);
        if traders.contains(&id) {
            jobs.insert(id, job_at(CityJobKind::Trade, None));
        } else if is_armed(&r.carried) {
            jobs.insert(id, job_at(CityJobKind::Soldier, None));
        } else if r.carrying.is_some() {
            jobs.insert(id, job_at(CityJobKind::Idle, None));
        } else if goes_on_reviving(old_jobs.get(&id), &mut waiting) {
            jobs.insert(id.clone(), old_jobs[&id].clone());
        } else if builds(world, i) {
            jobs.insert(id, job_at(CityJobKind::Build, None));
        } else if let Some(at) = at {
            let job = match places.iter().find(|&&b| world.buildings[b].id == at) {
                Some(&b) => work_job(&world.buildings[b]),
                None => job_at(CityJobKind::Work, Some(&at)),
            };
            jobs.insert(id, job);
        } else if let Some(feed) = feed {
            jobs.insert(id, feed);
            feeding = true;
        } else {
            spare.push(i);
        }
    }
    let unneeded = share_out(
        world,
        &city,
        &adults,
        &mut jobs,
        &mut held,
        spare,
        &place_ids,
        builders,
        short,
        &waiting,
        (home.as_ref(), crate::npc_roads::reborrow(&mut ways), terrain),
        size,
        &old_jobs,
    );
    // Trading posts and the HQ don't feed their stables this way.
    if city.trade_org.is_none() && !feeding {
        plan_feeder(world, &city, &adults, &mut jobs);
    }
    // The Trade Organization sends no trader and founds nothing.
    if city.trade_org.is_none() {
        send_traders(world, &city, &adults, &mut jobs, short, size);
        // A spare hand just sent off as a trader or to feed the stable isn't one any more.
        let left: Vec<usize> = unneeded
            .into_iter()
            .filter(|&i| {
                !jobs
                    .get(&world.residents[i].id)
                    .is_some_and(|j| j.kind == CityJobKind::Trade || j.kind == CityJobKind::Feed)
            })
            .collect();
        let city_now =
            world.cities.iter().find(|c| c.id == city_id).cloned().unwrap_or(city.clone());
        plan_founding(
            world,
            &city_now,
            &mut jobs,
            FoundingPeople { adults: &adults, unneeded: &left, members: &members },
            home.as_ref(),
            terrain,
        );
        plan_training(world, &city_now, &adults, &mut jobs, size);
    }
    world.city_plans.get_mut(city_id).expect("a plan").jobs = jobs;
}

/// How many farmers an NPC city keeps (`farmersWanted`): as many as feed all its residents, and
/// one more while it has no food surplus.
pub fn farmers_wanted(world: &WorldState, city: &City) -> f64 {
    feeders(city_residents(world, &city.id).len())
        + if has_food_surplus(world, city) { 0.0 } else { 1.0 }
}

/// Farmers who feed `residents`, rounded up (`feeders`).
fn feeders(residents: usize) -> f64 {
    (residents as f64 * FOOD_PER_DAY / WORK_OUTPUT_PER_DAY.get("food").unwrap_or(1.0) - 1e-9).ceil()
}

/// The job of working a workplace (`workJob`): `farm` for a farm, `work` for the rest.
fn work_job(place: &Building) -> CityJob {
    let kind = if place.kind == BuildingKind::Farm { CityJobKind::Farm } else { CityJobKind::Work };
    job_at(kind, Some(&place.id))
}

/// What a job offer gives (`JobOffer.take`), by kind.
enum Offer {
    Farm,
    Revive,
    Project,
    Short(Good),
    Road,
    Scout,
    Back,
    Surplus(usize),
}

/// How an NPC city shares out its adults beyond its soldiers and those carrying a child
/// (`shareOut`, `CONTEXT.md`: NPC city, NPC reserve; ADR 0029): each goes to the job that scores
/// highest with room, the spare hands first, then any worker whose job it beats by the margin.
/// Returns the spare hands nothing short has a use for.
#[allow(clippy::too_many_arguments)]
fn share_out(
    world: &mut WorldState,
    city: &City,
    adults: &[usize],
    jobs: &mut Jobs,
    held: &mut Places,
    mut spare: Vec<usize>,
    place_ids: &HashSet<String>,
    builders: f64,
    food_short: bool,
    waiting: &[String],
    roads: (Option<&Building>, Option<&mut dyn WayFinder>, Option<&TerrainMap>),
    size: i32,
    old_jobs: &Jobs,
) -> Vec<usize> {
    let project = world.city_plans[&city.id].project.clone();
    let own: Vec<usize> = crate::npc_chain::own_workplace_indices(world, city)
        .into_iter()
        .filter(|&b| world.buildings[b].site.is_none())
        .collect();
    let by_id: HashMap<String, usize> =
        own.iter().map(|&b| (world.buildings[b].id.clone(), b)).collect();
    let place_of = |world: &WorldState, jobs: &Jobs, i: usize| -> Option<usize> {
        let id = jobs.get(&world.residents[i].id)?.building_id.as_ref()?;
        by_id.get(id).copied()
    };
    let farms: Vec<usize> =
        own.iter().copied().filter(|&b| world.buildings[b].kind == BuildingKind::Farm).collect();
    let short = shortages(world, city, size, project.as_ref());
    let share_of: HashMap<Good, f64> = short.iter().map(|s| (s.good, s.share)).collect();
    // What a resident's job at a workplace is worth to them: what its good lacks, or only going back.
    let held_score = |world: &WorldState, jobs: &Jobs, i: usize| -> f64 {
        let good = place_of(world, jobs, i)
            .filter(|&b| world.buildings[b].kind != BuildingKind::Farm)
            .and_then(|b| chain_good(world, &world.buildings[b]));
        let Some(good) = good else { return job_score(ScoredJob::Short { share: 0.0 }) };
        match share_of.get(&good) {
            None => job_score(ScoredJob::Back),
            Some(&share) => job_score(ScoredJob::Short { share }),
        }
    };
    let give = |world: &WorldState,
                jobs: &mut Jobs,
                held: &mut Places,
                i: usize,
                job: CityJob,
                place: Option<usize>| {
        if let Some(left) = place_of(world, jobs, i) {
            held.leave(&world.buildings[left]);
        }
        jobs.insert(world.residents[i].id.clone(), job);
        if let Some(p) = place {
            held.take(&world.buildings[p]);
        }
    };
    let only_back = job_score(ScoredJob::Back);
    let scouts_out: HashSet<String> =
        world.city_plans[&city.id].scouts.iter().flat_map(|s| s.keys().cloned()).collect();
    if food_short {
        // Food runs short: workers off the farms go to the farms with room.
        let score = job_score(ScoredJob::Farm { food_short });
        let mut off: Vec<(usize, f64)> = adults
            .iter()
            .copied()
            .filter(|&i| {
                let job = jobs.get(&world.residents[i].id);
                job.is_some_and(|j| {
                    j.kind == CityJobKind::Work
                        && place_ids.contains(j.building_id.as_deref().unwrap_or(""))
                }) && beats(score, held_score(world, jobs, i))
            })
            .map(|i| (i, held_score(world, jobs, i)))
            .collect();
        off.extend(
            spare
                .iter()
                .copied()
                .filter(|i| scouts_out.contains(&world.residents[*i].id))
                .map(|i| (i, only_back)),
        );
        // Sorting keeps the order given among equals: surplus work ahead of scouts.
        off.sort_by(|a, b| a.1.total_cmp(&b.1));
        for (i, _) in off {
            let Some(&farm) = farms.iter().find(|&&f| held.room(&world.buildings[f]) > 0.0) else {
                break;
            };
            give(world, jobs, held, i, work_job(&world.buildings[farm]), Some(farm));
            if let Some(k) = spare.iter().position(|&s| s == i) {
                spare.remove(k);
            }
        }
    }
    let mut kept: IndexMap<String, CityJob> = IndexMap::new();
    let release = |world: &WorldState,
                   jobs: &mut Jobs,
                   held: &mut Places,
                   kept: &mut IndexMap<String, CityJob>,
                   spare: &mut Vec<usize>,
                   i: usize| {
        if let Some(place) = place_of(world, jobs, i) {
            held.leave(&world.buildings[place]);
        }
        let id = world.residents[i].id.clone();
        if let Some(job) = jobs.shift_remove(&id) {
            kept.insert(id, job);
        }
        spare.push(i);
    };
    // Workers of a workplace whose good the city isn't short of become spare hands, the farms aside.
    for &i in adults {
        if held_score(world, jobs, i) <= only_back && jobs.contains_key(&world.residents[i].id) {
            release(world, jobs, held, &mut kept, &mut spare, i);
        }
    }
    // A worker stays where they are until the city moves them.
    for &i in &spare {
        let id = &world.residents[i].id;
        let Some(before) = old_jobs.get(id) else { continue };
        if kept.contains_key(id) || !by_id.contains_key(before.building_id.as_deref().unwrap_or(""))
        {
            continue;
        }
        if before.kind == CityJobKind::Work || before.kind == CityJobKind::Farm {
            kept.insert(id.clone(), before.clone());
        }
    }
    // A scout out is called home for what is short only once those at hand have gone.
    spare.sort_by_key(|&i| scouts_out.contains(&world.residents[i].id));
    let wanted = farmers_wanted(world, city);
    let farmers: Vec<usize> = adults
        .iter()
        .copied()
        .filter(|&i| jobs.get(&world.residents[i].id).is_some_and(|j| j.kind == CityJobKind::Farm))
        .collect();
    if !food_short {
        for &i in farmers.iter().skip(wanted as usize).rev() {
            release(world, jobs, held, &mut kept, &mut spare, i);
        }
    }
    let farming =
        if food_short { farmers.len() as f64 } else { (farmers.len() as f64).min(wanted) };

    // Those holding a job a better one can take them from, at what it is worth to them.
    let mut workers: IndexMap<usize, f64> = adults
        .iter()
        .copied()
        .filter(|&i| jobs.get(&world.residents[i].id).is_some_and(|j| j.kind == CityJobKind::Work))
        .map(|i| (i, held_score(world, jobs, i)))
        .collect();
    let storage = chain_store_index(world, city);
    let (home, mut ways, terrain) = roads;
    let mut state = Share { builders, farming };
    let mut unneeded: Vec<usize> = Vec::new();

    let mut fill = |world: &mut WorldState,
                    jobs: &mut Jobs,
                    held: &mut Places,
                    kept: &IndexMap<String, CityJob>,
                    state: &mut Share,
                    ways: &mut Option<&mut dyn WayFinder>,
                    offers: Vec<(ScoredJob, Offer)>,
                    free: Vec<usize>|
     -> Vec<usize> {
        let mut free = free;
        for (job, offer) in rank_jobs(offers, |o| o.0) {
            let score = job_score(job);
            let beaten: Vec<usize> = workers
                .iter()
                .filter(|(i, holds)| {
                    jobs.get(&world.residents[**i].id).is_some_and(|j| j.kind == CityJobKind::Work)
                        && beats(score, **holds)
                })
                .map(|(i, _)| *i)
                .collect();
            let mut takers = free.clone();
            takers.extend(beaten);
            let took: Vec<usize> = match offer {
                Offer::Farm => takers
                    .into_iter()
                    .filter(|&i| {
                        if state.farming >= wanted {
                            return false;
                        }
                        let Some(&farm) =
                            farms.iter().find(|&&f| held.room(&world.buildings[f]) > 0.0)
                        else {
                            return false;
                        };
                        give(world, jobs, held, i, work_job(&world.buildings[farm]), Some(farm));
                        state.farming += 1.0;
                        true
                    })
                    .collect(),
                Offer::Revive => {
                    let mut leave = |i: usize, jobs: &Jobs| {
                        if let Some(place) = place_of(world, jobs, i) {
                            held.leave(&world.buildings[place]);
                        }
                        if jobs
                            .get(&world.residents[i].id)
                            .is_some_and(|j| j.kind == CityJobKind::Build)
                        {
                            state.builders -= 1.0;
                        }
                    };
                    send_revivers(
                        world, waiting, &takers, adults, jobs, food_short, size, &mut leave,
                    );
                    takers
                        .into_iter()
                        .filter(|&i| {
                            jobs.get(&world.residents[i].id)
                                .is_some_and(|j| j.kind == CityJobKind::Revive)
                        })
                        .collect()
                }
                Offer::Project => {
                    let project = project.clone().expect("a project");
                    takers
                        .into_iter()
                        .filter(|&i| {
                            if state.builders >= npc_builders(world, city)
                                || !can_take_part(world, city, i, &project)
                            {
                                return false;
                            }
                            give(world, jobs, held, i, job_at(CityJobKind::Build, None), None);
                            state.builders += 1.0;
                            true
                        })
                        .collect()
                }
                Offer::Short(good) => {
                    let mut took = Vec::new();
                    for i in takers {
                        let Some(place) = short_place(world, good, &own, held, storage) else {
                            break;
                        };
                        give(world, jobs, held, i, work_job(&world.buildings[place]), Some(place));
                        took.push(i);
                    }
                    took
                }
                Offer::Road => {
                    let returning: HashSet<String> = kept.keys().cloned().collect();
                    let crew = road_crew(
                        world,
                        city,
                        &takers,
                        &returning,
                        storage,
                        home,
                        crate::npc_roads::reborrow(ways),
                        terrain,
                    );
                    for &i in &crew {
                        give(world, jobs, held, i, job_at(CityJobKind::Road, None), None);
                    }
                    crew
                }
                Offer::Scout => {
                    let has_place = |i: usize| {
                        kept.get(&world.residents[i].id)
                            .and_then(|k| k.building_id.as_ref())
                            .is_some_and(|b| by_id.contains_key(b))
                    };
                    let scouts = pick_scouts(world, city, &takers, &has_place, food_short);
                    for &i in &scouts {
                        give(world, jobs, held, i, job_at(CityJobKind::Scout, None), None);
                    }
                    scouts
                }
                Offer::Back => {
                    let surplus = if city.trade_org.is_some() {
                        None
                    } else {
                        Some(SurplusWork::of(world, city, storage.map(|s| &world.buildings[s])))
                    };
                    takers
                        .into_iter()
                        .filter(|&i| {
                            let id = &world.residents[i].id;
                            let Some(back) = kept.get(id).cloned() else { return false };
                            let Some(&place) = back.building_id.as_ref().and_then(|b| by_id.get(b))
                            else {
                                return false;
                            };
                            let b = &world.buildings[place];
                            let worth = surplus.as_ref().is_none_or(|s| {
                                chain_good(world, b).is_none() || s.full(world, b).is_some()
                            });
                            if held.room(b) <= 0.0 || !worth {
                                return false;
                            }
                            give(world, jobs, held, i, back, Some(place));
                            true
                        })
                        .collect()
                }
                Offer::Surplus(place) => takers
                    .into_iter()
                    .filter(|&i| {
                        if held.room(&world.buildings[place]) <= 0.0 {
                            return false;
                        }
                        give(world, jobs, held, i, work_job(&world.buildings[place]), Some(place));
                        true
                    })
                    .collect(),
            };
            let took: HashSet<usize> = took.into_iter().collect();
            free.retain(|i| !took.contains(i));
            for i in &took {
                workers.shift_remove(i);
            }
        }
        free
    };

    let mut first: Vec<(ScoredJob, Offer)> = vec![
        (ScoredJob::Farm { food_short: false }, Offer::Farm),
        (ScoredJob::Revive, Offer::Revive),
    ];
    if project.is_some() {
        first.push((ScoredJob::Project, Offer::Project));
    }
    first.extend(short.iter().map(|s| (ScoredJob::Short { share: s.share }, Offer::Short(s.good))));
    let left = fill(world, jobs, held, &kept, &mut state, &mut ways, first, spare);
    unneeded.extend(left);
    if unneeded.is_empty() {
        return unneeded;
    }
    // Nothing short has a use for them (`CONTEXT.md`: Spare hands' work).
    let mut second: Vec<(ScoredJob, Offer)> = vec![
        (ScoredJob::Road, Offer::Road),
        (ScoredJob::Scout, Offer::Scout),
        (ScoredJob::Back, Offer::Back),
    ];
    if city.trade_org.is_none() {
        let surplus = SurplusWork::of(world, city, storage.map(|s| &world.buildings[s]));
        for &place in &own {
            if let Some(full) = surplus.full(world, &world.buildings[place]) {
                second.push((ScoredJob::Surplus { full }, Offer::Surplus(place)));
            }
        }
    }
    let idle = fill(world, jobs, held, &kept, &mut state, &mut ways, second, unneeded.clone());
    for i in idle {
        jobs.insert(world.residents[i].id.clone(), job_at(CityJobKind::Idle, None));
    }
    unneeded
}

/// The running counts of a share-out.
struct Share {
    builders: f64,
    farming: f64,
}

/// The workplace a spare hand goes to for a good short (`shortPlace`): of the city's finished
/// workplaces, one with room that makes it; for a good a workplace processes, only while the
/// storage holds a batch of its input, else the workplace of an input it lacks.
fn short_place(
    world: &WorldState,
    good: Good,
    own: &[usize],
    held: &Places,
    storage: Option<usize>,
) -> Option<usize> {
    let stock = storage.and_then(|s| world.buildings[s].stock.as_ref());
    fn work_for(
        world: &WorldState,
        g: Good,
        own: &[usize],
        held: &Places,
        stock: Option<&csp_shared::world::Stock>,
        seen: &mut HashSet<Good>,
    ) -> Option<usize> {
        if !seen.insert(g) {
            return None;
        }
        if let Some(input) = chain_input(g).filter(|i| !holds_batch(stock, i)) {
            for (from, n) in &input {
                if held_in(stock, *from) >= *n {
                    continue;
                }
                if let Some(place) = work_for(world, *from, own, held, stock, seen) {
                    return Some(place);
                }
            }
            return None;
        }
        own.iter().copied().find(|&b| {
            chain_good(world, &world.buildings[b]) == Some(g)
                && held.room(&world.buildings[b]) > 0.0
        })
    }
    work_for(world, good, own, held, stock, &mut HashSet::new())
}

/// Whether a resident could help with a project now (`canTakePart`): anything but a site that needs
/// materials neither they carry nor the storage holds.
fn can_take_part(world: &WorldState, city: &City, i: usize, project: &CityProject) -> bool {
    let (x, y) = match project {
        CityProject::TearDown { building_id } => {
            return world.buildings.iter().any(|b| &b.id == building_id)
        }
        CityProject::Build { x, y, .. } => (*x as i32, *y as i32),
    };
    let Some(site) = building_at(world, x, y, MAP_SIZE).filter(|s| s.site.is_some()) else {
        return true;
    };
    let need = materials_needed(site);
    if need.is_empty() {
        return true;
    }
    let storage = crate::npc_chain::chain_store(world, city);
    need.keys().any(|g| {
        held(&world.residents[i].carried, *g) > 0.0
            || held_in(storage.and_then(|s| s.stock.as_ref()), *g) > 0.0
    })
}

/// Whether a city's project is finished, or can't go on (`projectDone`).
pub fn project_done(world: &WorldState, project: &CityProject) -> bool {
    match project {
        CityProject::TearDown { building_id } => {
            !world.buildings.iter().any(|b| &b.id == building_id)
        }
        CityProject::Build { building, x, y } => building_at(world, *x as i32, *y as i32, MAP_SIZE)
            .is_some_and(|b| b.kind != *building || b.site.is_none()),
    }
}

/// Invariant `trade-org-sends-no-one` (`CONTEXT.md`: Trade Org HQ, Trading post; ADR 0004): no plan
/// of the HQ or a trading post gives anyone a `trade` or `found` job.
pub fn trade_org_sends_no_one(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for city in world.cities.iter().filter(|c| c.trade_org.is_some()) {
        let jobs = world.city_plans.get(&city.id).map(|p| &p.jobs);
        for (id, job) in jobs.into_iter().flatten() {
            if job.kind != CityJobKind::Trade && job.kind != CityJobKind::Found {
                continue;
            }
            let kind = if job.kind == CityJobKind::Trade { "trade" } else { "found" };
            out.push(InvariantViolation {
                invariant: "trade-org-sends-no-one".into(),
                message: format!("{}, of the Trade Organization, gives {id} a {kind} job", city.id),
                entity_ids: vec![city.id.clone(), id.clone()],
            });
        }
    }
    out
}

mod invariants;
pub(crate) use invariants::violation;
pub use invariants::{
    city_plans_sound, npc_farmers_kept, npc_spare_hands_work, npc_surplus_capped,
    npc_workplaces_bounded,
};

#[cfg(test)]
mod tests;

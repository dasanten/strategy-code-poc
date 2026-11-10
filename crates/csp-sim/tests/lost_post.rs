//! `lost-post.test.ts`, one test per `it`: a captured trading post is a crime nobody knows of
//! until a wandering trader or a witness brings the news (`CONTEXT.md`: Trading post, Crime,
//! Wandering trader).
//!
//! lost-post.test.ts: saves from before / stay as they are: posts lost before were never heard of.
//! That is the TypeScript's migration step 83, long before the freeze: the Rust server reads saves
//! from `FREEZE_FORMAT_VERSION` (111) on (`csp-server`'s `world_format.rs`, ADR 0030), so the step
//! and its test stay in TypeScript.

use std::sync::Arc;

use csp_shared::balance::{
    AVERAGE_HORSE_STATS, CRIME_MEMORY_DAYS, CRIME_STANDING_LOSS, SIGHT_RANGE, TRADE_ORG_LOSS,
};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    BuildingKind, Crime, CrimeKind, Good, Heading, Resident, TraderStand, TraderStop, WorldState,
};
use csp_sim::capture::capture_city;
use csp_sim::crimes::step_crimes;
use csp_sim::invariants::{check_all, check_invariants, world_invariants, InvariantViolation};
use csp_sim::queries::carriages::crew_ids_of;
use csp_sim::queries::city::town_hall_of;
use csp_sim::queries::standing::{standing_of, TRADE_ORG};
use csp_sim::random::Mulberry32;
use csp_sim::starting_city::found_starting_city;
use csp_sim::survival::die;
use csp_sim::tick::Scratch;
use csp_sim::trade_org::found_trade_org_hq;
use csp_sim::trade_org_debt::step_debts;
use csp_sim::trade_org_punishment::step_punishments;
use csp_sim::traders::{place_traders, step_traders, traders_sound};
use csp_sim::trading_posts::found_trading_post;
use csp_sim::walking::Walking;
use csp_sim::world::{create_world, step_world};
use serde_json::json;

const SIZE: i32 = 512;

fn terrain() -> TerrainMap {
    TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] }
}

/// The Trade Org HQ, three trading posts with its traders, and a Player's realm, all well apart
/// (`fixture`).
struct Fixture {
    world: WorldState,
    terrain: TerrainMap,
    hq: String,
    posts: Vec<String>,
    traders: Vec<String>,
    realm: String,
    leader: String,
}

fn fixture() -> Fixture {
    let terrain = terrain();
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    let mut rand = || m.next();
    let hq = found_trade_org_hq(&mut world, &terrain, 128, 128, &mut rand);
    let posts = vec![
        found_trading_post(&mut world, &terrain, 220, 128, None, &mut rand),
        found_trading_post(&mut world, &terrain, 220, 220, None, &mut rand),
        found_trading_post(&mut world, &terrain, 128, 220, None, &mut rand),
    ];
    let traders = place_traders(&mut world, SIZE);
    let s = AVERAGE_HORSE_STATS;
    for h in &mut world.horses {
        h.stats.speed = s.speed;
        h.stats.strength = s.strength;
        h.stats.endurance = s.endurance;
    }
    let realm = found_starting_city(&mut world, &terrain, 7, None);
    let (realm, leader) = (world.realms[realm].id.clone(), world.realms[realm].leader_id.clone());
    Fixture { world, terrain, hq, posts, traders, realm, leader }
}

impl Fixture {
    fn t(&self, id: &str) -> usize {
        self.world.traders.iter().position(|t| t.id == id).unwrap()
    }

    fn crew(&self, trader: &str) -> Vec<String> {
        let t = &self.world.traders[self.t(trader)];
        crew_ids_of(t.driver_id.as_deref(), &t.escort_ids)
    }

    fn r(&self, id: &str) -> &Resident {
        self.world.residents.iter().find(|r| r.id == id).unwrap()
    }

    fn r_mut(&mut self, id: &str) -> &mut Resident {
        self.world.residents.iter_mut().find(|r| r.id == id).unwrap()
    }

    /// The town hall of a city, as (x, y).
    fn hall(&self, city: &str) -> (f64, f64) {
        let c = self.world.cities.iter().find(|c| c.id == city).unwrap();
        let h = town_hall_of(&self.world, c).unwrap();
        (h.x, h.y)
    }

    /// Stands a trader on (x, y), armed, out to `post` with no stops to make on the way (`put`).
    fn put(&mut self, trader: &str, post: &str, x: f64, y: f64) {
        let ti = self.t(trader);
        let carriage_id = self.world.traders[ti].carriage_id.clone();
        let k = self.world.carriages.iter_mut().find(|k| k.id == carriage_id).unwrap();
        k.x = x;
        k.y = y;
        let horse_id = k.horse_id.clone();
        if let Some(h) = self.world.horses.iter_mut().find(|h| Some(&h.id) == horse_id.as_ref()) {
            h.x = x;
            h.y = y;
        }
        for id in self.crew(trader) {
            let r = self.r_mut(&id);
            r.x = x;
            r.y = y;
            r.order = None;
            r.carried.insert(Good::Spear, 1.0);
        }
        let t = &mut self.world.traders[ti];
        t.heading = Heading::Post;
        t.post_id = post.into();
        t.stop = TraderStop::Storage;
        t.calls = Some(Vec::new());
        t.stand = None;
    }

    /// `by`, armed, stands on the post's town hall as it falls to their realm (`capture`).
    fn capture(&mut self, post: &str, by: &str) {
        let (x, y) = self.hall(post);
        let r = self.r_mut(by);
        r.x = x;
        r.y = y;
        r.carried.insert(Good::Spear, 1.0);
        r.order = None;
        let owner = r.owner.clone().expect("a realm's");
        capture_city(&mut self.world, post, &owner, SIZE);
    }

    fn capture_of(&self, post: &str) -> Option<&Crime> {
        self.world
            .crimes
            .iter()
            .find(|c| c.kind == CrimeKind::Capture && c.post.as_deref() == Some(post))
    }

    /// Arms everyone at the HQ, so it has soldiers to spare for a punishment (`armHq`).
    fn arm_hq(&mut self) {
        let hq = self.hq.clone();
        for r in &mut self.world.residents {
            if r.owner.is_none() && r.city_id.as_deref() == Some(hq.as_str()) {
                r.carried.insert(Good::Spear, 1.0);
            }
        }
    }

    /// How the Trade Organization regards the realm (`regard`).
    fn regard(&self) -> f64 {
        standing_of(&self.world, TRADE_ORG, &self.realm)
    }

    fn loop_of(&self, trader: &str) -> &[String] {
        &self.world.traders[self.t(trader)].r#loop
    }

    fn crimes(&mut self) {
        step_crimes(&mut self.world, SIZE);
    }

    fn traders(&mut self) {
        step_traders(&mut self.world, SIZE, None);
    }

    fn crimes_sound(&self) -> Vec<InvariantViolation> {
        let only: Vec<_> =
            world_invariants().into_iter().filter(|i| i.name == "crimes-sound").collect();
        assert_eq!(only.len(), 1);
        check_invariants(&self.world, &self.terrain, &only)
    }

    fn traders_sound(&self) -> Vec<InvariantViolation> {
        traders_sound(&self.world, &self.terrain)
    }

    /// Steps the whole world until `done`, at most `ticks` times (`runUntil`).
    fn run_until(&mut self, done: impl Fn(&Fixture) -> bool, ticks: usize) {
        let mut walking = Walking::new(Arc::new(self.terrain.clone()));
        let mut scratch = Scratch::default();
        let terrain = self.terrain.clone();
        for _ in 0..ticks {
            if done(self) {
                break;
            }
            step_world(&mut self.world, &terrain, &mut scratch, Some(&mut walking), None);
        }
        assert!(done(self));
    }

    /// The driver of a trader's carriage's order, as JSON.
    fn driver_order(&self, trader: &str) -> serde_json::Value {
        let driver = self.crew(trader)[0].clone();
        serde_json::to_value(&self.r(&driver).order).unwrap()
    }
}

fn sorted(mut v: Vec<String>) -> Vec<String> {
    v.sort();
    v
}

// a captured trading post

#[test]
fn is_a_crime_nobody_knows_of_and_nothing_reacts_until_the_news_comes() {
    let mut f = fixture();
    let post = f.posts[0].clone();
    let leader = f.leader.clone();
    f.capture(&post, &leader);
    let city = f.world.cities.iter().find(|c| c.id == post).unwrap();
    assert!(city.trade_org.is_none());
    let crime = f.capture_of(&post).expect("a capture");
    assert_eq!(crime.culprit.resident_id, f.leader);
    assert_eq!(crime.culprit.org, f.realm);
    assert_eq!(crime.victim_org, f.hq);
    assert!(crime.witnesses.is_empty() && crime.known_by.is_empty());
    for t in &f.world.traders {
        assert!(t.r#loop.contains(&post), "{}", t.id);
    }
    for _ in 0..40 {
        f.crimes();
        step_punishments(&mut f.world, SIZE);
        f.world.tick += TICKS_PER_GAME_DAY as u64;
    }
    // Long past what a crime is remembered for, it still waits to be found out.
    let crime = f.capture_of(&post).expect("still kept");
    assert!(crime.witnesses.is_empty() && crime.known_by.is_empty());
    assert_eq!(f.regard(), 0.0);
    assert!(f.world.punishments.is_empty());
    assert_eq!(f.crimes_sound(), vec![]);
}

#[test]
fn has_none_of_its_own_residents_for_witnesses_they_joined_the_captor() {
    let mut f = fixture();
    let post = f.posts[0].clone();
    let own: Vec<String> = f
        .world
        .residents
        .iter()
        .filter(|r| r.city_id.as_deref() == Some(post.as_str()))
        .map(|r| r.id.clone())
        .collect();
    assert!(!own.is_empty());
    let leader = f.leader.clone();
    f.capture(&post, &leader);
    for id in &own {
        assert_eq!(f.r(id).owner.as_deref(), Some(f.realm.as_str()), "{id}");
    }
    assert!(f.capture_of(&post).unwrap().witnesses.is_empty());
}

#[test]
fn is_no_such_crime_for_any_other_city() {
    let mut f = fixture();
    let (hq, leader) = (f.hq.clone(), f.leader.clone());
    f.capture(&hq, &leader);
    assert!(!f.world.crimes.iter().any(|c| c.kind == CrimeKind::Capture));
}

// a wandering trader reaching a lost post

#[test]
fn drops_it_from_its_loop_goes_on_and_only_the_news_it_brings_causes_the_reaction() {
    let mut f = fixture();
    let (post, other, trader, leader) =
        (f.posts[0].clone(), f.posts[1].clone(), f.traders[0].clone(), f.leader.clone());
    f.arm_hq();
    f.capture(&post, &leader);
    let (hx, hy) = f.hall(&post);
    f.put(&trader, &post, hx, hy);
    let lp = f.loop_of(&trader).to_vec();
    let next = lp[(lp.iter().position(|id| *id == post).unwrap() + 1) % lp.len()].clone();
    f.traders();
    assert!(!f.loop_of(&trader).contains(&post));
    assert_eq!(f.world.traders[f.t(&trader)].post_id, next);
    let crew = f.crew(&trader);
    assert_eq!(sorted(f.capture_of(&post).unwrap().witnesses.clone()), sorted(crew));
    // It knows; the Trade Organization doesn't yet.
    f.crimes();
    assert!(f.capture_of(&post).unwrap().known_by.is_empty());
    assert_eq!(f.regard(), 0.0);
    // At another post, the news is in.
    let (ox, oy) = f.hall(&other);
    f.put(&trader, &other, ox, oy);
    f.crimes();
    let crime = f.capture_of(&post).unwrap();
    assert_eq!(crime.known_by, std::slice::from_ref(&crime.victim_org));
    assert!(crime.witnesses.is_empty());
    assert_eq!(f.regard(), -CRIME_STANDING_LOSS.capture);
    // A debt for its worth, and no army of its own (`CONTEXT.md`: Trade Org debt).
    step_debts(&mut f.world);
    step_punishments(&mut f.world, SIZE);
    assert_eq!(
        serde_json::to_value(&f.world.debts).unwrap(),
        json!([{ "org": f.realm, "coins": TRADE_ORG_LOSS.capture, "cityId": post }])
    );
    assert!(f.world.punishments.is_empty());
    assert_eq!(f.capture_of(&post).unwrap().punished, Some(true));
    assert_eq!(f.crimes_sound(), vec![]);
    assert_eq!(f.traders_sound(), vec![]);
}

#[test]
fn tells_the_hq_just_the_same() {
    let mut f = fixture();
    let (post, other, trader, leader, hq) = (
        f.posts[0].clone(),
        f.posts[1].clone(),
        f.traders[0].clone(),
        f.leader.clone(),
        f.hq.clone(),
    );
    f.capture(&post, &leader);
    let (hx, hy) = f.hall(&post);
    f.put(&trader, &post, hx, hy);
    f.traders();
    let (x, y) = f.hall(&hq);
    f.put(&trader, &other, x, y);
    f.crimes();
    assert_eq!(f.regard(), -CRIME_STANDING_LOSS.capture);
}

#[test]
fn remembers_it_from_when_the_news_came_however_long_the_post_stood_lost() {
    let mut f = fixture();
    let (post, other, trader, leader) =
        (f.posts[0].clone(), f.posts[1].clone(), f.traders[0].clone(), f.leader.clone());
    f.arm_hq();
    f.capture(&post, &leader);
    f.world.tick += (5.0 * CRIME_MEMORY_DAYS * TICKS_PER_GAME_DAY) as u64;
    let (hx, hy) = f.hall(&post);
    f.put(&trader, &post, hx, hy);
    f.traders();
    let (ox, oy) = f.hall(&other);
    f.put(&trader, &other, ox, oy);
    f.crimes();
    assert_eq!(f.capture_of(&post).unwrap().heard_at, Some(f.world.tick as f64));
    step_debts(&mut f.world);
    assert_eq!(f.world.debts.len(), 1);
    assert_eq!(f.crimes_sound(), vec![]);
    f.world.tick += (CRIME_MEMORY_DAYS * TICKS_PER_GAME_DAY) as u64;
    f.crimes();
    assert!(f.capture_of(&post).is_none());
    assert!(f.regard() < 0.0);
}

#[test]
#[ignore = "22.6 s alone; see #1092"]
fn drives_up_to_it_and_finds_out_running_the_whole_world_and_the_news_comes_in_by_the_next_post() {
    let mut f = fixture();
    let (post, trader, leader) = (f.posts[0].clone(), f.traders[0].clone(), f.leader.clone());
    f.capture(&post, &leader);
    let (hx, hy) = f.hall(&post);
    f.put(&trader, &post, hx - 40.0, hy);
    // It is a Player's city now, so its way there would stop at it too.
    let ti = f.t(&trader);
    f.world.traders[ti].calls = Some(vec![post.clone()]);
    let p = post.clone();
    let tr = trader.clone();
    f.run_until(move |f| !f.loop_of(&tr).contains(&p), 1500);
    assert!(!f.capture_of(&post).unwrap().witnesses.is_empty());
    let t = &f.world.traders[ti];
    assert_ne!(t.stand.as_ref().map(|s| s.city_id.as_str()), Some(post.as_str()));
    assert!(!t.calls.as_ref().is_some_and(|c| c.contains(&post)));
    assert_eq!(f.regard(), 0.0);
    f.run_until(|f| f.regard() < 0.0, 6000);
    assert_eq!(check_all(&f.world, &f.terrain), vec![]);
}

#[test]
fn finds_out_at_closed_gates_too_without_getting_in() {
    let mut f = fixture();
    let (post, trader, leader) = (f.posts[0].clone(), f.traders[0].clone(), f.leader.clone());
    f.capture(&post, &leader);
    for b in &mut f.world.buildings {
        if b.city_id.as_deref() == Some(post.as_str()) && b.kind == BuildingKind::Gate {
            b.closed = Some(true);
        }
    }
    let (hx, hy) = f.hall(&post);
    f.put(&trader, &post, hx - 40.0, hy);
    let crew = f.crew(&trader);
    let p = post.clone();
    let tr = trader.clone();
    f.run_until(move |f| !f.loop_of(&tr).contains(&p), 1500);
    assert_eq!(sorted(f.capture_of(&post).unwrap().witnesses.clone()), sorted(crew));
}

#[test]
fn gives_up_a_stop_there_and_leaves_the_city_out_of_its_calls_so_the_news_goes_straight_on() {
    let mut f = fixture();
    let (post, trader, leader) = (f.posts[0].clone(), f.traders[0].clone(), f.leader.clone());
    f.capture(&post, &leader);
    let (hx, hy) = f.hall(&post);
    f.put(&trader, &post, hx, hy);
    let ti = f.t(&trader);
    f.world.traders[ti].stand =
        Some(TraderStand { city_id: post.clone(), x: hx - 20.0, y: hy, until: None });
    let carriage = f.world.traders[ti].carriage_id.clone();
    let driver = f.crew(&trader)[0].clone();
    f.r_mut(&driver).order = Some(
        serde_json::from_value(json!({
            "kind": "drive", "carriageId": carriage, "target": { "x": hx - 20.0, "y": hy },
            "path": null, "progress": 0,
        }))
        .unwrap(),
    );
    f.traders();
    let t = &f.world.traders[ti];
    assert!(!t.r#loop.contains(&post));
    assert!(t.stand.is_none());
    let calls = t.calls.as_ref().expect("calls kept");
    assert!(!calls.contains(&post));
    // Off to the next post at once, not to the stop.
    let o = f.driver_order(&trader);
    assert_eq!(o["kind"], "drive", "{o}");
    assert_ne!(o["target"], json!({ "x": hx - 20.0, "y": hy }));
}

#[test]
fn goes_on_driving_to_a_stop_at_another_city() {
    let mut f = fixture();
    let (post, trader, leader) = (f.posts[0].clone(), f.traders[0].clone(), f.leader.clone());
    f.capture(&post, &leader);
    let (hx, hy) = f.hall(&post);
    f.put(&trader, &post, hx, hy);
    let ti = f.t(&trader);
    let stand = TraderStand { city_id: f.realm.clone(), x: hx - 20.0, y: hy, until: None };
    f.world.traders[ti].stand = Some(stand.clone());
    let carriage = f.world.traders[ti].carriage_id.clone();
    let driver = f.crew(&trader)[0].clone();
    let drive: csp_shared::world::ResidentOrder = serde_json::from_value(json!({
        "kind": "drive", "carriageId": carriage, "target": { "x": stand.x, "y": stand.y },
        "path": null, "progress": 0,
    }))
    .unwrap();
    f.r_mut(&driver).order = Some(drive.clone());
    f.traders();
    assert!(!f.loop_of(&trader).contains(&post));
    assert_eq!(f.world.traders[ti].stand, Some(stand));
    assert_eq!(f.r(&driver).order, Some(drive));
}

#[test]
fn with_no_crew_by_the_carriage_has_seen_nothing_yet() {
    let mut f = fixture();
    let (post, trader, leader) = (f.posts[0].clone(), f.traders[0].clone(), f.leader.clone());
    f.capture(&post, &leader);
    let (hx, hy) = f.hall(&post);
    f.put(&trader, &post, hx, hy);
    for id in f.crew(&trader) {
        die(&mut f.world, &id);
    }
    let stands = f.loop_of(&trader).len();
    f.traders();
    assert_eq!(f.loop_of(&trader).len(), stands);
    assert!(f.capture_of(&post).unwrap().witnesses.is_empty());
}

// a trader killed on the way

#[test]
fn brings_no_news_and_the_next_trader_that_gets_there_still_can() {
    let mut f = fixture();
    let (post, other, leader) = (f.posts[0].clone(), f.posts[1].clone(), f.leader.clone());
    let (first, second) = (f.traders[0].clone(), f.traders[1].clone());
    f.capture(&post, &leader);
    let (hx, hy) = f.hall(&post);
    f.put(&first, &post, hx, hy);
    f.traders();
    for id in f.crew(&first) {
        die(&mut f.world, &id);
    }
    f.crimes();
    let crime = f.capture_of(&post).expect("still kept");
    assert!(crime.witnesses.is_empty() && crime.known_by.is_empty());
    assert_eq!(f.regard(), 0.0);
    assert_eq!(f.crimes_sound(), vec![]);
    // The others still have it on their loops.
    f.put(&second, &post, hx, hy);
    f.traders();
    let (ox, oy) = f.hall(&other);
    f.put(&second, &other, ox, oy);
    f.crimes();
    assert_eq!(f.regard(), -CRIME_STANDING_LOSS.capture);
}

#[test]
fn and_with_no_trader_left_to_find_out_it_never_reacts() {
    let mut f = fixture();
    let (post, trader, leader) = (f.posts[0].clone(), f.traders[0].clone(), f.leader.clone());
    f.world.traders.retain(|t| t.id == trader);
    f.capture(&post, &leader);
    let (hx, hy) = f.hall(&post);
    f.put(&trader, &post, hx, hy);
    f.traders();
    for id in f.crew(&trader) {
        die(&mut f.world, &id);
    }
    f.crimes();
    assert!(f.capture_of(&post).is_none());
    assert_eq!(f.regard(), 0.0);
    assert_eq!(f.crimes_sound(), vec![]);
}

// a witness of the capture

/// One of the HQ's residents, in sight of the post's town hall (`bystander`).
fn bystander(f: &mut Fixture, post: &str) -> String {
    let hq = f.hq.clone();
    let id = f
        .world
        .residents
        .iter()
        .find(|x| x.city_id.as_deref() == Some(hq.as_str()) && x.owner.is_none())
        .unwrap()
        .id
        .clone();
    let (hx, hy) = f.hall(post);
    let r = f.r_mut(&id);
    r.x = hx + SIGHT_RANGE;
    r.y = hy;
    id
}

#[test]
fn who_gets_away_brings_the_news_to_the_hq() {
    let mut f = fixture();
    let (post, leader, hq) = (f.posts[0].clone(), f.leader.clone(), f.hq.clone());
    let witness = bystander(&mut f, &post);
    f.capture(&post, &leader);
    assert!(f.capture_of(&post).unwrap().witnesses.contains(&witness));
    f.crimes();
    assert_eq!(f.regard(), 0.0);
    let (x, y) = f.hall(&hq);
    let r = f.r_mut(&witness);
    r.x = x;
    r.y = y;
    f.crimes();
    assert_eq!(f.regard(), -CRIME_STANDING_LOSS.capture);
}

#[test]
fn who_gets_to_another_post_brings_it_there_one_of_that_posts_own_as_well() {
    let mut f = fixture();
    let (post, other, leader) = (f.posts[0].clone(), f.posts[1].clone(), f.leader.clone());
    let (hx, hy) = f.hall(&post);
    let witness = f
        .world
        .residents
        .iter()
        .find(|x| x.city_id.as_deref() == Some(other.as_str()))
        .unwrap()
        .id
        .clone();
    let r = f.r_mut(&witness);
    r.x = hx + 10.0;
    r.y = hy;
    f.capture(&post, &leader);
    assert!(f.capture_of(&post).unwrap().witnesses.contains(&witness));
    let (x, y) = f.hall(&other);
    let r = f.r_mut(&witness);
    r.x = x;
    r.y = y;
    f.crimes();
    assert_eq!(f.regard(), -CRIME_STANDING_LOSS.capture);
}

#[test]
fn who_is_killed_first_brings_nothing() {
    let mut f = fixture();
    let (post, leader) = (f.posts[0].clone(), f.leader.clone());
    let witness = bystander(&mut f, &post);
    f.capture(&post, &leader);
    die(&mut f.world, &witness);
    f.crimes();
    assert_eq!(f.regard(), 0.0);
    assert_eq!(f.crimes_sound(), vec![]);
}

#[test]
fn who_joins_the_culprit_with_the_fall_of_the_hq_takes_the_news_with_them() {
    let mut f = fixture();
    let (post, leader, hq) = (f.posts[0].clone(), f.leader.clone(), f.hq.clone());
    let witness = bystander(&mut f, &post);
    f.capture(&post, &leader);
    assert!(f.capture_of(&post).unwrap().witnesses.contains(&witness));
    f.capture(&hq, &leader);
    assert_eq!(f.r(&witness).owner.as_deref(), Some(f.realm.as_str()));
    f.crimes();
    assert!(f.capture_of(&post).is_none());
    assert_eq!(check_all(&f.world, &f.terrain), vec![]);
}

// invariants of a lost post

#[test]
fn allow_it_on_a_loop_but_not_a_city_that_is_gone() {
    let mut f = fixture();
    let (post, trader, leader) = (f.posts[0].clone(), f.traders[0].clone(), f.leader.clone());
    f.capture(&post, &leader);
    assert_eq!(f.traders_sound(), vec![]);
    assert_eq!(check_all(&f.world, &f.terrain), vec![]);
    f.world.cities.retain(|c| c.id != post);
    let messages: Vec<String> = f.traders_sound().into_iter().map(|v| v.message).collect();
    let want = format!("trader {trader} has {post} on its loop, which is no city");
    assert!(messages.contains(&want), "{messages:?}");
    // And the trader lets go of it, which forgets a crime nobody can find out any more.
    f.traders();
    f.crimes();
    assert!(!f.loop_of(&trader).contains(&post));
    assert!(f.capture_of(&post).is_none());
    assert_eq!(f.traders_sound(), vec![]);
}

#[test]
fn catch_a_capture_kept_with_no_way_left_to_hear_of_it_or_naming_no_post() {
    let mut f = fixture();
    let (post, leader) = (f.posts[0].clone(), f.leader.clone());
    f.capture(&post, &leader);
    let crime = f.capture_of(&post).unwrap().clone();
    assert_eq!(f.crimes_sound(), vec![]);
    for t in &mut f.world.traders {
        t.r#loop.retain(|id| *id != post);
    }
    let messages: Vec<String> = f.crimes_sound().into_iter().map(|v| v.message).collect();
    assert_eq!(messages, [format!("crime {} is kept though forgotten", crime.id)]);
    let mut changed = crime.clone();
    changed.witnesses = vec![leader.clone()];
    changed.post = None;
    f.world.crimes = vec![changed];
    let messages: Vec<String> = f.crimes_sound().into_iter().map(|v| v.message).collect();
    let want =
        format!("crime {} names a post without being a capture, or the other way round", crime.id);
    assert!(messages.contains(&want), "{messages:?}");
}

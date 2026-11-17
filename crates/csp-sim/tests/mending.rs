//! Mending at the smithy (`CONTEXT.md`: Mending): a worker set to mend puts the most worn piece
//! there back to good for a share of its recipe, faster than forging it.

mod build_common;

use build_common::{building, new_resident, player, realm, Orders};
use csp_shared::balance::{BATCHES_PER_DAY, MEND_WORK_SHARE};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, Good, Pile, ResidentOrder, Stock, WorldState};
use csp_sim::invariants::check_all;
use csp_sim::mending::{mend_input, piece_to_mend};
use csp_sim::tick::Scratch;
use csp_sim::wear::{condition_of, in_use, PieceCondition};
use csp_sim::world::{create_world, step_world};
use serde_json::json;

fn terrain() -> TerrainMap {
    TerrainMap { size: 16, tiles: vec![Terrain::Plains as u8; 16 * 16] }
}

fn stock(pairs: &[(Good, f64)]) -> Stock {
    pairs.iter().copied().collect()
}

/// Realm r1 (Player 7), a finished smithy at (2, 2) and resident w1 on it carrying a Sword worn
/// to `worn` and the Iron and Wood given.
fn setup(worn: f64, carried: &[(Good, f64)]) -> (WorldState, Orders) {
    let mut world = create_world(&terrain(), 1);
    world.realms.push(realm("r1", 7, "w1"));
    world.buildings.insert(0, building("s1", BuildingKind::Smithy, 2.0, 2.0));
    let mut w1 = new_resident("w1", Some("r1"), 2.0, 2.0);
    w1.carried = stock(carried);
    *w1.carried.entry(Good::Sword).or_insert(0.0) += 1.0;
    world.residents.push(w1);
    world.wear.insert("w1".into(), [(Good::Sword, vec![worn])].into_iter().collect());
    csp_sim::equipment::settle_all(&mut world);
    (world, Orders::default())
}

fn order(world: &mut WorldState, q: &mut Orders, makes: &str) -> String {
    let o = json!({ "kind": "workAt", "residentId": "w1", "makes": makes });
    let answer = q.receive(world, &player(7), o, &terrain());
    q.apply_all(world, &terrain());
    match answer {
        Ok(()) => "ack".into(),
        Err(reason) => reason,
    }
}

fn run(world: &mut WorldState, ticks: usize) {
    let mut scratch = Scratch::default();
    for _ in 0..ticks {
        for r in &mut world.residents {
            r.hunger = 100.0;
        }
        step_world(world, &terrain(), &mut scratch, None, None);
    }
}

#[track_caller]
fn assert_sound(world: &WorldState) {
    let broken: Vec<String> = check_all(world, &terrain())
        .into_iter()
        .map(|v| format!("{}: {}", v.invariant, v.message))
        .collect();
    assert_eq!(broken, Vec::<String>::new());
}

fn held(world: &WorldState, g: Good) -> f64 {
    world.residents[0].carried.get(&g).copied().unwrap_or(0.0)
}

/// Ticks one average worker takes to mend one piece.
fn mend_ticks() -> usize {
    let batches = BATCHES_PER_DAY.get("smithy").expect("batches");
    (TICKS_PER_GAME_DAY * MEND_WORK_SHARE / batches).ceil() as usize
}

#[test]
fn mending_a_piece_takes_a_share_of_its_recipe_rounded_and_at_least_one_unit() {
    assert_eq!(mend_input(Good::Sword), Some(vec![(Good::Iron, 1.0)]));
    assert_eq!(mend_input(Good::Armour), Some(vec![(Good::Iron, 2.0)]));
    assert_eq!(mend_input(Good::Spear), Some(vec![(Good::Wood, 1.0)]));
    assert_eq!(mend_input(Good::Shield), Some(vec![(Good::Wood, 1.0)]));
    assert_eq!(mend_input(Good::SteelArmour), Some(vec![(Good::Steel, 2.0)]));
    assert!(mend_input(Good::Tools).is_some(), "a set of Tools mends too");
    assert_eq!(mend_input(Good::Iron), None);
}

#[test]
fn a_worker_set_to_mend_puts_a_worn_sword_back_to_good_and_uses_its_share() {
    let (mut world, mut q) = setup(0.7, &[(Good::Iron, 5.0)]);
    assert_eq!(order(&mut world, &mut q, "mend"), "ack");
    let Some(ResidentOrder::WorkAt(o)) = &world.residents[0].order else { panic!("work order") };
    assert!(o.mends && o.makes.is_none());
    assert_eq!(condition_of(in_use(&world, "w1", Good::Sword)), PieceCondition::Worn);
    run(&mut world, mend_ticks() + 2);
    assert_eq!(in_use(&world, "w1", Good::Sword), 0.0, "good as new");
    assert_eq!(held(&world, Good::Sword), 1.0);
    assert_eq!(held(&world, Good::Iron), 4.0, "one Iron for a worn Sword");
    assert!(world.wear.is_empty());
    // Nothing left to mend: they stand idle and use nothing more.
    run(&mut world, mend_ticks() * 2);
    assert_eq!(held(&world, Good::Iron), 4.0);
    assert_sound(&world);
}

#[test]
fn mending_is_faster_than_forging() {
    let (mut world, mut q) = setup(0.9, &[(Good::Iron, 5.0)]);
    assert_eq!(order(&mut world, &mut q, "mend"), "ack");
    let batches = BATCHES_PER_DAY.get("smithy").expect("batches");
    let forge_ticks = (TICKS_PER_GAME_DAY / batches) as usize;
    assert!(mend_ticks() < forge_ticks);
    run(&mut world, mend_ticks() + 2);
    assert_eq!(in_use(&world, "w1", Good::Sword), 0.0);
}

#[test]
fn stands_idle_without_the_input_and_mends_nothing_in_good_condition() {
    let (mut world, mut q) = setup(0.7, &[(Good::Wood, 5.0)]);
    assert_eq!(order(&mut world, &mut q, "mend"), "ack");
    run(&mut world, mend_ticks() * 3);
    assert_eq!(in_use(&world, "w1", Good::Sword), 0.7, "no Iron, no mending");

    let (world, _) = setup(0.2, &[(Good::Iron, 5.0)]);
    assert_eq!(piece_to_mend(&world, &world.buildings[0]), None, "a good piece needs none");
}

#[test]
fn mends_the_most_worn_piece_on_the_smithys_pile_too() {
    let (mut world, mut q) = setup(0.6, &[(Good::Iron, 5.0)]);
    world.piles.push(Pile {
        id: "p1".into(),
        x: 2.0,
        y: 2.0,
        goods: stock(&[(Good::Armour, 1.0)]),
    });
    world.wear.insert("p1".into(), [(Good::Armour, vec![0.95])].into_iter().collect());
    assert_eq!(order(&mut world, &mut q, "mend"), "ack");
    run(&mut world, mend_ticks() + 2);
    assert!(!world.wear.contains_key("p1"), "the nearly broken Armour first");
    assert_eq!(in_use(&world, "w1", Good::Sword), 0.6);
    assert_eq!(held(&world, Good::Iron), 3.0, "two Iron for Armour");
    run(&mut world, mend_ticks() + 2);
    assert_eq!(in_use(&world, "w1", Good::Sword), 0.0, "then the Sword");
    assert_sound(&world);
}

#[test]
fn only_a_smithy_mends() {
    let (mut world, mut q) = setup(0.7, &[]);
    world.buildings[0].kind = BuildingKind::Mint;
    assert_eq!(order(&mut world, &mut q, "mend"), "only a smithy mends");
}

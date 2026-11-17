//! `apps/server/src/smithy.test.ts`: the smithy, and weapons and armour (`CONTEXT.md`: Smithy,
//! Weapons and armour).

mod build_common;
mod ts_match;

use build_common::{building, new_resident, player, realm, Orders};
use csp_shared::balance::{
    BATCHES_PER_DAY, BUILD_MATERIALS, BUILD_WORK, GOOD_WEIGHT, PROTECTION_DEFENCE, RECIPES,
    WEAPON_ATTACK, WORKPLACE_SKILL, WORK_SKILL_PER_DAY,
};
use csp_shared::goods::{PROTECTION, WEAPONS};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, Good, Pile, SkillName, Stock, WorldState};
use csp_sim::invariants::{check_all, invariant_named};
use csp_sim::queries::building::{recipe_for, recipe_good, workplace_good, BUILDABLE};
use csp_sim::queries::goods::pile_at;
use csp_sim::tick::Scratch;
use csp_sim::world::{create_world, step_world};
use serde_json::{json, Value};
use ts_match::{assert_matches, json_of};

fn terrain() -> TerrainMap {
    TerrainMap { size: 16, tiles: vec![Terrain::Plains as u8; 16 * 16] }
}

fn arms() -> Vec<&'static str> {
    WEAPONS.iter().chain(PROTECTION.iter()).copied().collect()
}

/// What a weapon or piece of armour is forged from besides Wood: Steel for the steel ones
/// (`CONTEXT.md`: Coal), else Iron.
fn metal(made: &str) -> &'static str {
    if made.starts_with("steel") {
        "steel"
    } else {
        "iron"
    }
}

fn good(name: &str) -> Good {
    serde_json::from_value(json!(name)).expect("a good")
}

/// A world with realm r1 (Player 7), a finished smithy at (2, 2) and resident w1 on it.
fn setup() -> (WorldState, Orders) {
    let mut world = create_world(&terrain(), 1);
    world.realms.push(realm("r1", 7, "w1"));
    world.buildings.insert(0, building("s1", BuildingKind::Smithy, 2.0, 2.0));
    world.residents.push(new_resident("w1", Some("r1"), 2.0, 2.0));
    (world, Orders::default())
}

/// Sends a work-at order for resident `id` and answers whether it was taken.
fn work(world: &mut WorldState, q: &mut Orders, id: &str, makes: Option<Value>) -> String {
    let mut o = json!({ "kind": "workAt", "residentId": id });
    if let Some(m) = makes {
        o["makes"] = m;
    }
    let answer = q.receive(world, &player(7), o, &terrain());
    q.apply_all(world, &terrain());
    match answer {
        Ok(()) => "ack".into(),
        Err(reason) => reason,
    }
}

/// Steps the world, keeping residents fed.
fn run(world: &mut WorldState, ticks: usize) {
    let mut scratch = Scratch::default();
    for _ in 0..ticks {
        for r in &mut world.residents {
            r.hunger = 100.0;
        }
        step_world(world, &terrain(), &mut scratch, None, None);
    }
}

/// All units of a good anywhere: carried and in piles.
fn total(world: &WorldState, g: Good) -> f64 {
    world.residents.iter().map(|r| r.carried.get(&g).copied().unwrap_or(0.0)).sum::<f64>()
        + world.piles.iter().map(|p| p.goods.get(&g).copied().unwrap_or(0.0)).sum::<f64>()
}

#[track_caller]
fn assert_sound(world: &WorldState) {
    let broken: Vec<String> = check_all(world, &terrain())
        .into_iter()
        .map(|v| format!("{}: {}", v.invariant, v.message))
        .collect();
    assert_eq!(broken, Vec::<String>::new());
}

fn stock(pairs: &[(Good, f64)]) -> Stock {
    pairs.iter().copied().collect()
}

mod weapons_and_armour_balance_file {
    use super::*;

    #[test]
    fn a_smithy_has_one_recipe_from_iron_or_steel_and_wood_for_each_weapon_and_piece_of_armour() {
        let recipes = RECIPES.get("smithy").expect("smithy recipes");
        let mut made: Vec<&str> = recipes.iter().map(recipe_good).collect();
        // And one for Tools (`CONTEXT.md`: Tools), of Iron and Wood too.
        let mut want = arms();
        want.push("tools");
        made.sort_unstable();
        want.sort_unstable();
        assert_eq!(made, want);
        for r in recipes {
            let mut inputs: Vec<&str> = r.input.0.iter().map(|(g, _)| *g).collect();
            inputs.sort_unstable();
            let m = metal(recipe_good(r));
            assert_eq!(inputs, [m, "wood"]);
            assert_eq!(json_of(&r.output), json!({ recipe_good(r): 1.0 }));
            // Nothing is lost or gained in weight at the anvil.
            let weight: f64 =
                r.input.0.iter().map(|(g, n)| n * GOOD_WEIGHT.get(g).expect("a weight")).sum();
            assert_eq!(Some(weight), GOOD_WEIGHT.get(recipe_good(r)));
        }
        assert!(BATCHES_PER_DAY.get("smithy").expect("batches") > 0.0);
        assert_eq!(WORKPLACE_SKILL.get("smithy"), Some("smithing"));
    }

    #[test]
    fn a_steel_sword_shield_and_armour_take_steel_where_the_iron_one_takes_iron_and_beat_it() {
        let steel_of =
            [("sword", "steelSword"), ("shield", "steelShield"), ("armour", "steelArmour")];
        for (iron, steel) in steel_of {
            let i = recipe_for(BuildingKind::Smithy, Some(iron)).expect("an iron recipe");
            let s = recipe_for(BuildingKind::Smithy, Some(steel)).expect("a steel recipe");
            assert_eq!(i.input.get("iron"), s.input.get("steel"), "{steel}");
            assert_eq!(i.input.get("wood"), s.input.get("wood"), "{steel}");
            let better = |t: &csp_shared::balance::Table<f64>| t.get(steel) > t.get(iron);
            assert!(better(&WEAPON_ATTACK) || better(&PROTECTION_DEFENCE), "{steel}");
        }
        // The Spear stays iron only.
        assert!(recipe_for(BuildingKind::Smithy, Some("steelSpear")).is_none());
        assert_eq!(WEAPONS.iter().filter(|w| w.contains("pear")).count(), 1);
    }

    #[test]
    fn weapons_attack_shields_and_armour_defend_and_all_of_them_weigh_something() {
        for w in WEAPONS {
            assert!(WEAPON_ATTACK.get(w).expect("an attack") > 0.0);
        }
        for p in PROTECTION {
            assert!(PROTECTION_DEFENCE.get(p).expect("a defence") > 0.0);
        }
        for g in arms() {
            assert!(GOOD_WEIGHT.get(g).expect("a weight") > 0.0);
        }
    }

    #[test]
    fn a_smithy_can_be_built_off_nodes_from_stone_wood_and_iron() {
        assert!(BUILDABLE.contains(&BuildingKind::Smithy));
        let materials = BUILD_MATERIALS.get("smithy").expect("materials");
        assert!(materials.get("iron").is_some());
        assert!(BUILD_WORK.get("smithy").expect("work") > 0.0);
    }
}

mod the_smithy {
    use super::*;

    /// `it.each(ARMS)`: one run per weapon and piece of armour.
    #[test]
    fn turns_the_iron_and_wood_its_worker_carries_into_each_on_its_pile() {
        for made in arms() {
            let (mut world, mut q) = setup();
            assert_eq!(work(&mut world, &mut q, "w1", Some(json!(made))), "ack");
            assert_matches(&world.residents[0].order, json!({ "kind": "workAt", "makes": made }));
            let smithy = world.buildings[0].clone();
            assert_eq!(
                json_of(&workplace_good(&world, &smithy, Some(good(made)))),
                json!(made),
                "{made}"
            );
            let m = good(metal(made));
            world.residents[0].carried = stock(&[(m, 20.0), (Good::Wood, 10.0)]);
            run(&mut world, TICKS_PER_GAME_DAY as usize + 2);
            let batches = BATCHES_PER_DAY.get("smithy").expect("batches");
            let recipe = recipe_for(BuildingKind::Smithy, Some(made)).expect("a recipe");
            let g = good(made);
            assert_eq!(
                pile_at(&world, 2.0, 2.0).and_then(|p| p.goods.get(&g)).copied(),
                Some(batches)
            );
            let r = &world.residents[0];
            let input = |n: &str| recipe.input.get(n).expect("an input");
            assert_eq!(r.carried.get(&m).copied(), Some(20.0 - batches * input(metal(made))));
            assert_eq!(r.carried.get(&Good::Wood).copied(), Some(10.0 - batches * input("wood")));
            let skill = r.skills.get(&SkillName::Smithing).copied().unwrap_or(0.0);
            assert!((skill - WORK_SKILL_PER_DAY).abs() < 0.005, "{made}: {skill}");
            assert_sound(&world);
        }
    }

    #[test]
    fn uses_the_pile_on_its_tile_and_conserves_weight_by_the_recipe() {
        let (mut world, mut q) = setup();
        world.residents.push(new_resident("w2", Some("r1"), 2.0, 2.0));
        assert_eq!(work(&mut world, &mut q, "w1", Some(json!("sword"))), "ack");
        assert_eq!(work(&mut world, &mut q, "w2", Some(json!("shield"))), "ack");
        world.piles.push(Pile {
            id: "p1".into(),
            x: 2.0,
            y: 2.0,
            goods: stock(&[(Good::Iron, 30.0), (Good::Wood, 30.0)]),
        });
        let weight = |w: &WorldState| {
            ["iron", "wood", "sword", "shield"]
                .iter()
                .map(|g| total(w, good(g)) * GOOD_WEIGHT.get(g).expect("a weight"))
                .sum::<f64>()
        };
        let before = weight(&world);
        for _ in 0..4 {
            run(&mut world, TICKS_PER_GAME_DAY as usize / 2);
            assert_eq!(weight(&world), before);
            assert_sound(&world);
        }
        assert!(total(&world, Good::Sword) > 0.0);
        assert!(total(&world, Good::Shield) > 0.0);
    }

    #[test]
    fn stands_idle_without_the_input_for_what_the_worker_makes() {
        let (mut world, mut q) = setup();
        assert_eq!(work(&mut world, &mut q, "w1", Some(json!("armour"))), "ack");
        world.residents[0].carried = stock(&[(Good::Iron, 6.0), (Good::Wood, 5.0)]);
        run(&mut world, TICKS_PER_GAME_DAY as usize);
        let r = &world.residents[0];
        assert_matches(&r.order, json!({ "kind": "workAt", "progress": 0 }));
        assert_eq!(r.skills.get(&SkillName::Smithing).copied().unwrap_or(0.0), 0.0);
        assert_eq!(json_of(&r.carried), json!({ "iron": 6.0, "wood": 5.0 }));
    }

    #[test]
    fn a_worker_can_switch_to_making_something_else() {
        let (mut world, mut q) = setup();
        assert_eq!(work(&mut world, &mut q, "w1", Some(json!("spear"))), "ack");
        assert_eq!(work(&mut world, &mut q, "w1", Some(json!("spear"))), "already working here");
        assert_eq!(work(&mut world, &mut q, "w1", Some(json!("shield"))), "ack");
        assert_matches(&world.residents[0].order, json!({ "kind": "workAt", "makes": "shield" }));
    }

    #[test]
    fn turns_down_an_order_that_says_nothing_or_something_it_cant_make() {
        let (mut world, mut q) = setup();
        let said = work(&mut world, &mut q, "w1", None);
        assert!(said.contains("say what to make"), "{said}");
        let said = work(&mut world, &mut q, "w1", Some(json!("iron")));
        assert!(said.contains("can't make iron"), "{said}");
        assert_eq!(work(&mut world, &mut q, "w1", Some(json!("gold"))), "no such good");
        assert_eq!(work(&mut world, &mut q, "w1", Some(json!(7))), "no such good");
    }

    #[test]
    fn a_mint_takes_no_choice_a_smelter_iron_unless_told_steel() {
        // A smelter makes Iron or Steel (`CONTEXT.md`: Coal, T101.4), Iron when told nothing.
        let (mut world, mut q) = setup();
        world.buildings[0].kind = BuildingKind::Mint;
        let said = work(&mut world, &mut q, "w1", Some(json!("coins")));
        assert!(said.contains("nothing to choose"), "{said}");
        world.buildings[0].kind = BuildingKind::Smelter;
        let said = work(&mut world, &mut q, "w1", Some(json!("spear")));
        assert!(said.contains("can't make spear"), "{said}");
        assert_eq!(work(&mut world, &mut q, "w1", None), "ack");
        assert_eq!(work(&mut world, &mut q, "w1", Some(json!("steel"))), "ack");
    }

    #[test]
    fn the_invariant_catches_a_smithy_worker_making_nothing_or_a_choice_where_there_is_none() {
        let (mut world, _) = setup();
        let first = |w: &WorldState| {
            (invariant_named("work-orders-on-workplaces").expect("an invariant").check)(
                w,
                &terrain(),
            )
            .into_iter()
            .map(|v| v.message)
            .next()
        };
        let set = |w: &mut WorldState, makes: Option<&str>| {
            let mut o = json!({ "kind": "workAt", "buildingId": "s1", "at": { "x": 2, "y": 2 }, "progress": 0 });
            if let Some(m) = makes {
                o["makes"] = json!(m);
            }
            w.residents[0].order = Some(serde_json::from_value(o).expect("a workAt order"));
        };
        set(&mut world, None);
        assert!(first(&world).is_some_and(|m| m.contains("making nothing")));
        set(&mut world, Some("iron"));
        assert!(first(&world).is_some_and(|m| m.contains("can't make iron")));
        set(&mut world, Some("spear"));
        assert_eq!(first(&world), None);
        world.buildings[0].kind = BuildingKind::Mint;
        assert!(first(&world).is_some_and(|m| m.contains("nothing to choose")));
        // A smelter makes Iron unless told Steel (`CONTEXT.md`: Coal), but no weapons.
        world.buildings[0].kind = BuildingKind::Smelter;
        assert!(first(&world).is_some_and(|m| m.contains("can't make spear")));
        for makes in [None, Some("iron"), Some("steel")] {
            set(&mut world, makes);
            assert_eq!(first(&world), None);
        }
    }
}

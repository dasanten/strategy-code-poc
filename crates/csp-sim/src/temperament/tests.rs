//! Temperament (`CONTEXT.md`: Temperament, T98.1): drawn from the city's id when it comes into
//! being, a daughter mostly takes its mother's, and every NPC city has one.

use csp_shared::balance::NPC_DAUGHTER_TAKES_MOTHERS_TEMPERAMENT;
use csp_shared::world::{BuildingKind, Remembered, Temperament, TradeOrgCity};
use serde_json::json;

use super::*;
use crate::cities::found_city;
use crate::test_world::{add_city, building, empty_world};

#[test]
fn a_city_gets_the_same_temperament_from_its_id_every_time_and_ids_draw_all_three() {
    for id in ["city1", "city7", "city42"] {
        assert_eq!(pick_temperament(3, id), pick_temperament(3, id));
    }
    let mut count = [0; 3];
    for i in 0..3000 {
        let t = pick_temperament(3, &format!("city{i}"));
        count[TEMPERAMENTS.iter().position(|&x| x == t).unwrap()] += 1;
    }
    // About a third each.
    assert!(count.iter().all(|&n| (800..1200).contains(&n)), "{count:?}");
}

#[test]
fn a_daughter_mostly_takes_its_mothers_temperament() {
    for mother in TEMPERAMENTS {
        let same = (0..3000)
            .filter(|i| daughter_temperament(3, &format!("city{i}"), mother) == mother)
            .count() as f64
            / 3000.0;
        // Its mother's by the chance, or by drawing the same one of its own a third of the rest.
        let want = NPC_DAUGHTER_TAKES_MOTHERS_TEMPERAMENT
            + (1.0 - NPC_DAUGHTER_TAKES_MOTHERS_TEMPERAMENT) / 3.0;
        assert!((same - want).abs() < 0.04, "{mother:?}: {same}");
        assert!(same < 1.0, "some daughters differ");
    }
}

#[test]
fn a_city_of_no_realm_gets_one_when_founded_a_players_city_none() {
    let mut world = empty_world();
    let a = building(&mut world, "hall1", BuildingKind::TownHall, None, 10.0, 10.0);
    let b = building(&mut world, "hall2", BuildingKind::TownHall, None, 80.0, 80.0);
    let npc = found_city(&mut world, a, None);
    let theirs = found_city(&mut world, b, Some("r1"));
    let id = world.cities[npc].id.clone();
    assert_eq!(world.cities[npc].temperament, Some(pick_temperament(world.seed, &id)));
    assert_eq!(world.cities[theirs].temperament, None);
}

#[test]
fn a_daughter_takes_hers_from_its_mother() {
    let mut world = empty_world();
    add_city(&mut world, "mother", None, 10.0, 10.0, None);
    add_city(&mut world, "daughter", None, 80.0, 80.0, None);
    world.cities[0].temperament = Some(Temperament::Merchant);
    inherit_temperament(&mut world, "mother", "daughter");
    assert_eq!(
        world.cities[1].temperament,
        Some(daughter_temperament(world.seed, "daughter", Temperament::Merchant))
    );
}

#[test]
fn a_city_with_none_stored_reads_the_one_its_id_draws_a_trading_post_none() {
    let mut world = empty_world();
    add_city(&mut world, "old", None, 10.0, 10.0, None);
    add_city(&mut world, "post", None, 40.0, 40.0, Some(TradeOrgCity::Post));
    let seed = world.seed;
    assert_eq!(temperament_of(seed, &world.cities[0]), Some(pick_temperament(seed, "old")));
    assert_eq!(temperament_of(seed, &world.cities[1]), None);
    world.cities[0].temperament = Some(Temperament::Merchant);
    assert_eq!(temperament_of(seed, &world.cities[0]), Some(Temperament::Merchant));
}

#[test]
fn flags_a_trading_post_with_a_temperament() {
    let mut world = empty_world();
    add_city(&mut world, "npc", None, 10.0, 10.0, None);
    add_city(&mut world, "post", None, 40.0, 40.0, Some(TradeOrgCity::Post));
    add_city(&mut world, "mine", Some("r1"), 80.0, 80.0, None);
    world.cities[0].temperament = Some(Temperament::Settler);
    // A Player's city that was an NPC city may keep what it was like.
    world.cities[2].temperament = Some(Temperament::Settler);
    assert!(trading_posts_have_no_temperament(&world).is_empty());
    world.cities[1].temperament = Some(Temperament::Merchant);
    let messages: Vec<String> =
        trading_posts_have_no_temperament(&world).into_iter().map(|v| v.message).collect();
    assert_eq!(messages, ["post is the Trade Organization's but has a temperament"]);
}

#[test]
fn a_player_remembers_the_temperament_of_a_city_seen_last_seen() {
    let mut world = empty_world();
    add_city(&mut world, "npc", None, 10.0, 10.0, None);
    world.cities[0].temperament = Some(Temperament::Militarist);
    // What sight sends of it, as Last seen keeps it.
    let mut seen = serde_json::to_value(&world.cities[0]).unwrap();
    seen["is"] = json!("city");
    seen["seenAt"] = json!(5);
    let Remembered::City(c) = serde_json::from_value::<Remembered>(seen).unwrap() else {
        panic!("a city")
    };
    assert_eq!(c.temperament, Some(Temperament::Militarist));
    assert_eq!(serde_json::to_value(&c).unwrap()["temperament"], "militarist");
}

//! The city layouts (`city_layout`) against the frozen TypeScript: `src/city_layout/expected.json`,
//! written by `src/city_layout/gen-expected.mts`, holds what each layout's plan says of every tile
//! around the home of the village and the HQ fixture worlds, for several gate plans, and the
//! streets the city owes.

mod common;

use csp_shared::world::{BuildingKind, CityLayout, WorldState};
use csp_sim::city_layout::{layout_plan, streets_owed, GateAt};
use csp_sim::queries::building::road_tiles;
use csp_sim::survival::npc_home;
use serde_json::Value;

use common::{read_json, terrain_of};

const R: i32 = 16;

#[test]
fn every_layout_says_of_every_tile_what_the_typescript_says() {
    let expected: Value =
        serde_json::from_str(include_str!("../src/city_layout/expected.json")).expect("expected");
    for case in expected.as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let file = read_json(&format!("worlds/{name}.json"));
        let terrain = terrain_of(&file);
        let size = terrain.size;
        let mut world: WorldState = serde_json::from_value(file["world"].clone()).unwrap();
        let layout: CityLayout = serde_json::from_value(case["layout"].clone()).unwrap();
        world.cities[0].layout = Some(layout);
        let gate = case["gate"].as_object().map(|g| GateAt {
            dx: g["dx"].as_i64().unwrap() as i32,
            dy: g["dy"].as_i64().unwrap() as i32,
        });
        let city = world.cities[0].clone();
        let home = npc_home(&world, &city.id).unwrap().clone();
        assert_eq!(home.id, case["home"].as_str().unwrap());
        let plan = layout_plan(&world, &city, &home, gate, size).unwrap();
        let what = format!("{name} {layout:?} {gate:?}");
        let rows = |f: &dyn Fn(i32, i32) -> String| -> Vec<String> {
            (-R..=R)
                .map(|dy| {
                    (-R..=R)
                        .map(|dx| {
                            let x = (home.x as i32 + dx).rem_euclid(size);
                            let y = (home.y as i32 + dy).rem_euclid(size);
                            f(x, y)
                        })
                        .collect()
                })
                .collect()
        };
        let want = |v: &Value| -> Vec<String> {
            v.as_array().unwrap().iter().map(|l| l.as_str().unwrap().to_string()).collect()
        };
        let bit = |b: bool| if b { "1".to_string() } else { "0".to_string() };
        assert_eq!(rows(&|x, y| bit(plan.street(x, y))), want(&case["street"]), "{what} street");
        for (kind, k) in [
            ("house", BuildingKind::House),
            ("storage", BuildingKind::Storage),
            ("stable", BuildingKind::Stable),
        ] {
            let spots = rows(&|x, y| bit(plan.spot(k, x, y)));
            assert_eq!(spots, want(&case["spots"][kind]), "{what} spots of {kind}");
            if case["spill"].is_null() {
                assert!(!plan.has_spill());
            } else {
                let spill = rows(&|x, y| bit(plan.spill(k, x, y).unwrap()));
                assert_eq!(spill, want(&case["spill"][kind]), "{what} spill of {kind}");
            }
        }
        if case["rank"].is_null() {
            assert!(!plan.has_rank());
        } else {
            let rank = rows(&|x, y| format!("{},", plan.rank(BuildingKind::House, x, y).unwrap()));
            assert_eq!(rank, want(&case["rank"]), "{what} rank");
        }
        let roads = road_tiles(&world, size);
        let owed = streets_owed(&world, &city, &home, gate, &terrain, &roads);
        let want_owed: Vec<(i32, i32)> = serde_json::from_value(case["streets"].clone()).unwrap();
        assert_eq!(owed, want_owed, "{what} streets owed");
    }
}

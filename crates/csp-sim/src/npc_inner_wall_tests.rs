//! `npc-inner-wall.test.ts`'s slow simulation (#1038), once for each of its layouts: the staged
//! big city building its inner ring for real. The file's other cases are not ported yet.

use std::collections::HashSet;

use csp_shared::balance::BUILD_MATERIALS;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{Building, BuildingKind, CityLayout, CityProject, Good};
use serde_json::json;

use crate::city_layout::GateAt;
use crate::invariants::check_all;
use crate::npc_big_city::{big_city_laid, Staged, Unhurried};
use crate::npc_growth::{wall_rings, Rings};
use crate::npc_inner_wall::{inner_wall, InnerWallTile};
use crate::queries::names::held;
use crate::queries::npc_trade::{npc_city_stock, npc_reserve};
use crate::random::new_id;
use crate::tick::Scratch;
use crate::world::step_world;

/// The staged big city with a stable out of the way and a training ground just outside its outer
/// wall, and Wood to spare (`ready`).
fn ready(layout: CityLayout) -> Staged {
    let mut s = big_city_laid(Some(layout), 240);
    let home = s.home().clone();
    let outer = rings_of(&s).outer;
    for (kind, x, y, city) in [
        ("stable", home.x + 30.0, home.y + 30.0, Some(s.city.clone())),
        // Just outside its outer wall, so in its area and well off the ring.
        ("trainingGround", home.x + f64::from(outer) + 1.0, home.y - 1.0, None),
    ] {
        let id = new_id("b", &mut s.world.next_id);
        let b: Building =
            serde_json::from_value(json!({ "id": id, "kind": kind, "cityId": city, "x": x, "y": y }))
                .unwrap();
        s.world.buildings.push(b);
    }
    let wood = held(&npc_reserve(&s.world, s.city()), Good::Wood) + 500.0;
    let hi = s.world.buildings.iter().position(|b| b.id == s.home).unwrap();
    s.world.buildings[hi].stock.get_or_insert_with(Default::default).insert(Good::Wood, wood);
    s
}

fn rings_of(s: &Staged) -> Rings {
    wall_rings(&s.world, s.city(), s.home(), s.terrain.size).expect("rings")
}

fn ring_of(s: &Staged) -> Vec<InnerWallTile> {
    let rings = rings_of(s);
    let gate = rings.gate.as_ref().expect("a gate").1;
    let new_gate = GateAt { dx: rings.new_gate.dx, dy: rings.new_gate.dy };
    inner_wall(&s.world, s.city(), s.home(), &s.terrain, gate, new_gate)
}

fn finishes_its_ring(layout: CityLayout) {
    let mut s = ready(layout);
    let mut walking = Unhurried::new(&s.terrain);
    let mut scratch = Scratch::default();
    let want: HashSet<(i64, i64)> = ring_of(&s).iter().map(|t| (t.x as i64, t.y as i64)).collect();
    let standing = |s: &Staged| -> Vec<Building> {
        s.world
            .buildings
            .iter()
            .filter(|b| {
                matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate)
                    && b.site.is_none()
                    && want.contains(&(b.x as i64, b.y as i64))
            })
            .cloned()
            .collect()
    };
    let rings = rings_of(&s);
    let wood = BUILD_MATERIALS.get("wall").and_then(|m| m.get("wood")).unwrap_or(0.0);
    let mut t = 0;
    while t < 14 * TICKS_PER_GAME_DAY as usize && standing(&s).len() < want.len() {
        step_world(&mut s.world, &s.terrain, &mut scratch, Some(&mut walking), None);
        // Its gate last: the way stays open.
        if s.world.tick.is_multiple_of(60) && standing(&s).len() < want.len() - 1 {
            assert!(!standing(&s).iter().any(|b| b.kind == BuildingKind::Gate), "{layout:?}");
        }
        // A tile is only ever taken on with Wood above the reserve, whatever else uses it.
        if let Some(plan) = s.world.city_plans.get(&s.city) {
            if let Some(CityProject::Build { x, y, .. }) = plan.project {
                if plan.planned_at == s.world.tick as f64 && want.contains(&(x as i64, y as i64)) {
                    let above = held(&npc_city_stock(&s.world, s.city()), Good::Wood)
                        - held(&npc_reserve(&s.world, s.city()), Good::Wood);
                    assert!(above >= -wood, "{layout:?}: {above}");
                }
            }
        }
        if s.world.tick.is_multiple_of(TICKS_PER_GAME_DAY as u64) {
            assert_eq!(check_all(&s.world, &s.terrain), []);
        }
        t += 1;
    }
    let up = standing(&s);
    assert_eq!(up.len(), want.len(), "{layout:?}");
    assert_eq!(up.iter().filter(|b| b.kind == BuildingKind::Gate).count(), 1);
    let now = rings_of(&s);
    assert!(now.gate.is_some());
    assert_eq!(
        (now.inner, now.outer, now.expanding, now.new_gate),
        (rings.inner, rings.outer, rings.expanding, rings.new_gate),
        "{layout:?}"
    );
}

#[test]
#[ignore = "timed in the PR"]
fn finishes_its_ring_in_a_grid_city_from_what_it_has_above_its_reserve_its_gate_last() {
    finishes_its_ring(CityLayout::Grid);
}

#[test]
#[ignore = "timed in the PR"]
fn finishes_its_ring_in_a_rings_city_from_what_it_has_above_its_reserve_its_gate_last() {
    finishes_its_ring(CityLayout::Rings);
}

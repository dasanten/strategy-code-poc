//! `npc-inner-wall.test.ts`, its slow simulation: a big city building its inner ring for real.

use csp_shared::balance::BUILD_MATERIALS;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, CityLayout, CityProject, Good};

use super::big_city_fixture::{big_city, BigCity};
use super::unhurried_walking;
use crate::invariants::check_all;
use crate::npc_growth::{wall_rings, Rings};
use crate::npc_inner_wall::inner_wall;
use crate::npc_test_world::Runner;
use crate::queries::npc_trade::{npc_city_stock, npc_reserve};
use crate::random::new_id;
use crate::tick::Scratch;

/// The big city with nothing left to want but its inner ring: its stable and training ground, and
/// the Wood above its reserve for the whole ring (`ready`).
fn ready(layout: CityLayout) -> BigCity {
    let mut s = big_city(Some(layout), 240);
    let (hx, hy) = (s.home().x, s.home().y);
    let city = s.city.clone();
    let id = new_id("b", &mut s.world.next_id);
    let stable =
        crate::test_support::building(&id, BuildingKind::Stable, Some(&city), hx + 30.0, hy + 30.0);
    s.world.buildings.push(stable);
    // Just outside its outer wall, so in its area and well off the ring.
    let outer = rings_of(&s).outer;
    let id = new_id("b", &mut s.world.next_id);
    let ground = crate::test_support::building(
        &id,
        BuildingKind::TrainingGround,
        None,
        hx + f64::from(outer) + 1.0,
        hy - 1.0,
    );
    s.world.buildings.push(ground);
    let wood = npc_reserve(&s.world, s.city()).get(&Good::Wood).copied().unwrap_or(0.0) + 500.0;
    s.home_mut().stock.get_or_insert_with(Default::default).insert(Good::Wood, wood);
    s
}

fn rings_of(s: &BigCity) -> Rings {
    wall_rings(&s.world, s.city(), s.home(), s.terrain.size).expect("rings")
}

/// The ring's tiles as the plan has them (`ringOf`).
fn ring_of(s: &BigCity) -> Vec<(i32, i32)> {
    let rings = rings_of(s);
    let gate = rings.gate.as_ref().expect("a gate").1;
    let new_gate = crate::city_layout::GateAt { dx: rings.new_gate.dx, dy: rings.new_gate.dy };
    inner_wall(&s.world, s.city(), s.home(), &s.terrain, gate, new_gate)
        .into_iter()
        .map(|t| (t.x, t.y))
        .collect()
}

fn finishes_its_ring(layout: CityLayout) {
    let mut s = ready(layout);
    let mut runner = Runner { walking: unhurried_walking(&s.terrain), scratch: Scratch::default() };
    let want = ring_of(&s);
    let standing = |s: &BigCity| -> Vec<BuildingKind> {
        s.world
            .buildings
            .iter()
            .filter(|b| {
                matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate)
                    && b.site.is_none()
                    && want.contains(&(b.x as i32, b.y as i32))
            })
            .map(|b| b.kind)
            .collect()
    };
    let rings = rings_of(&s);
    let wood = BUILD_MATERIALS.get("wall").and_then(|m| m.get("wood")).unwrap_or(0.0);
    let mut t = 0;
    while t < 14 * TICKS_PER_GAME_DAY as usize && standing(&s).len() < want.len() {
        runner.step(&mut s.world, &s.terrain);
        // Its gate last: the way stays open.
        let up = standing(&s);
        if s.world.tick.is_multiple_of(60) && up.len() < want.len() - 1 {
            assert!(!up.contains(&BuildingKind::Gate), "a gate before the ring is done");
        }
        // A tile is only ever taken on with Wood above the reserve, whatever else uses it.
        if let Some(plan) = s.world.city_plans.get(&s.city) {
            if let Some(CityProject::Build { x, y, .. }) = &plan.project {
                if plan.planned_at == s.world.tick as f64 && want.contains(&(*x as i32, *y as i32))
                {
                    let has =
                        npc_city_stock(&s.world, s.city()).get(&Good::Wood).copied().unwrap_or(0.0);
                    let keeps =
                        npc_reserve(&s.world, s.city()).get(&Good::Wood).copied().unwrap_or(0.0);
                    assert!(has - keeps >= -wood, "{has} against a reserve of {keeps}");
                }
            }
        }
        if s.world.tick.is_multiple_of(TICKS_PER_GAME_DAY as u64) {
            assert_eq!(check_all(&s.world, &s.terrain), []);
        }
        t += 1;
    }
    eprintln!("ring of {} finished by tick {}", want.len(), s.world.tick);
    let up = standing(&s);
    assert_eq!(up.len(), want.len());
    assert_eq!(up.iter().filter(|k| **k == BuildingKind::Gate).count(), 1);
    let now = rings_of(&s);
    assert!(now.gate.is_some());
    assert_eq!(Rings { gate: None, ..now }, Rings { gate: None, ..rings });
}

#[test]
#[ignore = "TODO(time) alone; see #1092"]
fn finishes_its_ring_in_a_grid_city_from_what_it_has_above_its_reserve_its_gate_last() {
    finishes_its_ring(CityLayout::Grid);
}

#[test]
#[ignore = "TODO(time) alone; see #1092"]
fn finishes_its_ring_in_a_rings_city_from_what_it_has_above_its_reserve_its_gate_last() {
    finishes_its_ring(CityLayout::Rings);
}

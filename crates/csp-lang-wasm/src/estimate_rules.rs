//! Way estimates for the client (T122.8, `CONTEXT.md`: Doing, Estimates): `csp-sim`'s own
//! `arrival_ticks` on a resident in the world mirror, with the ground of the way's tiles passed in,
//! as the mirror holds no terrain. One call per way, never one per tile.

use std::collections::HashMap;

use csp_shared::terrain::Terrain;
use csp_shared::world::{ResidentOrder, WorldState};
use csp_sim::queries::estimates;
use csp_sim::running::moving;

/// About how many ticks until resident `id` arrives where they walk, ride or drive
/// (`arrivalTicks`), on `world` of side `size`. `order`, when given, is the way to estimate in place
/// of the resident's own order (a way the Player is about to give, as the route preview shows it).
/// `ground` is the ground of each tile of that order's path, in its order, as the client knows it
/// (`groundAt`: a road over any terrain, Plains where unexplored); a tile it doesn't cover reads as
/// Plains. None for a resident not in the world, or one going nowhere.
pub fn arrival_ticks(
    world: &WorldState,
    size: i32,
    id: &str,
    order: Option<ResidentOrder>,
    ground: &[u8],
) -> Option<f64> {
    let r = world.residents.iter().find(|r| r.id == id)?;
    let with_order;
    let r = match order {
        Some(o) => {
            with_order = csp_shared::world::Resident { order: Some(o), ..r.clone() };
            &with_order
        }
        None => r,
    };
    let path = moving(r.order.as_ref())?.path.as_ref()?;
    let by_tile: HashMap<(i32, i32), u8> =
        path.iter().zip(ground).map(|(&(x, y), &g)| ((x as i32, y as i32), g)).collect();
    let ground = |x: f64, y: f64| {
        by_tile.get(&(x as i32, y as i32)).copied().unwrap_or(Terrain::Plains as u8)
    };
    estimates::arrival_ticks(world, size, &ground, r)
}

#[cfg(test)]
mod tests {
    use csp_shared::world::{Resident, Tile, WalkOrder};

    use super::*;

    fn walker(path: Vec<(f64, f64)>) -> Resident {
        let order = ResidentOrder::WalkTo(WalkOrder {
            target: Tile { x: 4.0, y: 0.0 },
            path: Some(path),
            progress: 0.0,
            army: None,
        });
        let mut r: Resident = serde_json::from_value(serde_json::json!({
            "id": "r1", "name": "Ana", "owner": null, "cityId": null, "x": 0, "y": 0,
            "stats": {
                "strength": { "base": 10, "trained": 0 }, "endurance": { "base": 10, "trained": 0 },
                "agility": { "base": 10, "trained": 0 }, "intellect": { "base": 10, "trained": 0 }
            },
            "skills": {}, "health": 100, "hunger": 100, "bornAt": 0, "lifespan": 1e12,
            "carried": {}, "order": null
        }))
        .expect("a resident");
        r.order = Some(order);
        r
    }

    #[test]
    fn answers_as_csp_sim_does_with_the_ground_of_each_tile() {
        let path = vec![(1.0, 0.0), (2.0, 0.0), (3.0, 0.0), (4.0, 0.0)];
        let world = WorldState { residents: vec![walker(path)], ..WorldState::default() };
        let ground = [
            Terrain::Plains as u8,
            Terrain::Plains as u8,
            Terrain::Forest as u8,
            Terrain::Road as u8,
        ];
        let theirs = |x: f64, _: f64| ground[x as usize - 1];
        let want = estimates::arrival_ticks(&world, 64, &theirs, &world.residents[0]);
        assert!(want.is_some());
        assert_eq!(arrival_ticks(&world, 64, "r1", None, &ground), want);
        // Slower ground on the way takes longer than Plains all along.
        let plains = arrival_ticks(&world, 64, "r1", None, &[]).unwrap();
        assert!(want.unwrap() != plains);
        assert_eq!(arrival_ticks(&world, 64, "nobody", None, &ground), None);
    }

    #[test]
    fn estimates_a_way_given_in_place_of_the_residents_order() {
        let world = WorldState {
            residents: vec![Resident { order: None, ..walker(vec![]) }],
            ..WorldState::default()
        };
        assert_eq!(arrival_ticks(&world, 64, "r1", None, &[]), None);
        let way = walker(vec![(1.0, 0.0), (2.0, 0.0)]).order;
        let ticks = arrival_ticks(&world, 64, "r1", way, &[]).unwrap();
        assert!(ticks > 0.0);
    }
}

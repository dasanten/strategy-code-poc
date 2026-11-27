//! NPC cities' archers (T108.5, `CONTEXT.md`: Ranged combat, NPC reserve, Soldier posts): a city
//! with a smithy arms `NPC_ARCHER_SHARE` of its soldiers with a Bow and keeps Arrows in its
//! reserve, and its archers stand on its wall; one without a smithy has none.

use csp_shared::balance::{NPC_ARCHER_ARROWS, NPC_TOWN};
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, Good, Stock, WorldState};

use crate::invariants::check_all;
use crate::npc_cities::found_npc_city;
use crate::npc_posts::{free_soldiers, soldier_posts};
use crate::npc_test_world::{plains, Runner};
use crate::queries::names::held;
use crate::queries::npc_trade::{
    is_npc_archer, npc_archer_target, npc_reserve, npc_smithy_good, npc_soldier_target,
    npc_tools_wanted,
};
use crate::queries::residents::{can_work, is_armed};
use crate::random::Mulberry32;
use crate::world::create_world;

const DAY: usize = TICKS_PER_GAME_DAY as usize;

struct Town {
    world: WorldState,
    terrain: TerrainMap,
    city: String,
}

impl Town {
    /// An NPC town alone on a Plains map, its top-left wall tile at (20, 20), with a smithy among
    /// its workplaces if `smithy`, and `stock` in its storage.
    fn new(smithy: bool, stock: &[(Good, f64)]) -> Self {
        let terrain = plains(192);
        let mut world = create_world(&terrain, 1);
        let mut m = Mulberry32::new(7.0);
        let city = found_npc_city(&mut world, &terrain, &NPC_TOWN, 20, 20, &mut || m.next(), None);
        let mut t = Town { world, terrain, city };
        if smithy {
            let hall = t.building(BuildingKind::TownHall);
            let (x, y) = (t.world.buildings[hall].x, t.world.buildings[hall].y);
            let smithy =
                crate::test_support::building("smithy", BuildingKind::Smithy, None, x + 4.0, y);
            t.world.buildings.push(smithy);
            let id = t.city.clone();
            t.world.cities.iter_mut().find(|c| c.id == id).unwrap().workplace_ids =
                Some(vec!["smithy".into()]);
        }
        let s = t.building(BuildingKind::Storage);
        let store = t.world.buildings[s].stock.get_or_insert_with(Stock::new);
        for (g, n) in stock {
            store.insert(*g, *n);
        }
        t
    }

    fn city(&self) -> &csp_shared::world::City {
        self.world.cities.iter().find(|c| c.id == self.city).expect("the city")
    }

    fn building(&self, kind: BuildingKind) -> usize {
        self.world
            .buildings
            .iter()
            .position(|b| b.city_id.as_deref() == Some(self.city.as_str()) && b.kind == kind)
            .expect("a building of the city")
    }

    /// Where in `world.residents` its grown residents are.
    fn adults(&self) -> Vec<usize> {
        let tick = self.world.tick as f64;
        (0..self.world.residents.len())
            .filter(|&i| {
                let r = &self.world.residents[i];
                r.owner.is_none()
                    && r.health > 0.0
                    && r.city_id.as_deref() == Some(self.city.as_str())
                    && can_work(r.born_at, tick)
            })
            .collect()
    }

    fn archers(&self) -> Vec<usize> {
        self.adults().into_iter().filter(|&i| is_npc_archer(&self.world.residents[i])).collect()
    }

    fn stored(&self, good: Good) -> f64 {
        let s = self.building(BuildingKind::Storage);
        self.world.buildings[s].stock.as_ref().map_or(0.0, |st| held(st, good))
    }

    /// Runs the world for `ticks`, checking the invariants every game day.
    fn run(&mut self, ticks: usize) {
        let mut runner = Runner::new(&self.terrain);
        for _ in 0..ticks {
            runner.step(&mut self.world, &self.terrain);
            if self.world.tick.is_multiple_of(DAY as u64) {
                assert_eq!(check_all(&self.world, &self.terrain), []);
            }
        }
    }
}

/// Weapons for every soldier, and Bows and Arrows for its archers and their reserve.
fn armoury() -> Vec<(Good, f64)> {
    vec![(Good::Spear, 6.0), (Good::Bow, 3.0), (Good::Arrows, 200.0)]
}

#[test]
fn a_town_with_a_smithy_arms_its_share_of_archers_and_keeps_arrows_in_reserve() {
    let mut t = Town::new(true, &armoury());
    let adults = t.adults().len() as f64;
    let want = npc_archer_target(&t.world, t.city(), adults);
    assert_eq!(want, (npc_soldier_target(adults) / 2.0).floor());
    assert!(want >= 1.0, "a town wants archers: {want}");
    t.run(3 * DAY);
    let archers = t.archers();
    assert_eq!(archers.len() as f64, want, "the share of its soldiers carry a Bow");
    for &i in &archers {
        let r = &t.world.residents[i];
        assert!(is_armed(r) && held(&r.carried, Good::Spear) == 0.0, "{:?}", r.carried);
        assert!(held(&r.carried, Good::Arrows) >= NPC_ARCHER_ARROWS / 2.0, "{:?}", r.carried);
    }
    let soldiers = t.adults().into_iter().filter(|&i| is_armed(&t.world.residents[i])).count();
    assert_eq!(soldiers as f64, npc_soldier_target(t.adults().len() as f64));
    // Its reserve keeps Arrows for each archer, and its storage holds them.
    let reserve = npc_reserve(&t.world, t.city());
    assert_eq!(held(&reserve, Good::Arrows), want * NPC_ARCHER_ARROWS);
    assert!(t.stored(Good::Arrows) >= want * NPC_ARCHER_ARROWS);
}

#[test]
fn a_town_with_no_smithy_has_no_archers() {
    let mut t = Town::new(false, &armoury());
    assert_eq!(npc_archer_target(&t.world, t.city(), t.adults().len() as f64), 0.0);
    t.run(3 * DAY);
    assert!(t.archers().is_empty());
    let reserve = npc_reserve(&t.world, t.city());
    assert_eq!((held(&reserve, Good::Bow), held(&reserve, Good::Arrows)), (0.0, 0.0));
}

#[test]
fn its_archers_take_wall_posts_and_the_others_the_hall_and_gates() {
    let mut t = Town::new(true, &armoury());
    t.run(3 * DAY);
    let adults = t.adults();
    let free = free_soldiers(&t.world, t.city(), &adults);
    let posts = soldier_posts(&t.world, t.city(), &free, t.terrain.size, Some(&t.terrain));
    let walls: Vec<(i32, i32)> = t
        .world
        .buildings
        .iter()
        .filter(|b| b.city_id.as_deref() == Some(t.city.as_str()) && b.kind == BuildingKind::Wall)
        .map(|b| (b.x as i32, b.y as i32))
        .collect();
    let mut on_wall = 0;
    for &i in &free {
        let r = &t.world.residents[i];
        let post = &posts[&r.id];
        if is_npc_archer(r) {
            assert!(walls.contains(&post.at), "archer {} posted off the wall: {:?}", r.id, post.at);
            on_wall += 1;
        }
    }
    assert!(on_wall >= 1, "an archer was free to post");
    // The others hold the hall first.
    let hall = &t.world.buildings[t.building(BuildingKind::TownHall)];
    let on_hall = free
        .iter()
        .filter(|&&i| {
            let at = posts[&t.world.residents[i].id].at;
            csp_shared::footprint::covers(crate::queries::names::placed(hall), at.0, at.1, 192)
        })
        .collect::<Vec<_>>();
    assert!(!on_hall.is_empty());
    assert!(on_hall.iter().all(|&&i| !is_npc_archer(&t.world.residents[i])));
}

#[test]
fn its_smithy_forges_bows_then_arrows_once_its_soldiers_are_armed() {
    let mut t = Town::new(true, &[]);
    let target = npc_soldier_target(t.adults().len() as f64) as usize;
    // Its soldiers armed with spears, nothing in store: a Bow first, for an archer to take.
    for &i in t.adults().iter().take(target) {
        t.world.residents[i].carried.insert(Good::Spear, 1.0);
        crate::equipment::settle_equipment(&mut t.world.residents[i]);
    }
    assert_eq!(npc_smithy_good(&t.world, t.city()), Good::Bow);
    let s = t.building(BuildingKind::Storage);
    t.world.buildings[s].stock.get_or_insert_with(Stock::new).insert(Good::Bow, 3.0);
    assert_eq!(npc_smithy_good(&t.world, t.city()), Good::Arrows);
    t.world.buildings[s].stock.get_or_insert_with(Stock::new).insert(Good::Arrows, 200.0);
    // Then the Tools its workers want (`CONTEXT.md`: Tools).
    assert_eq!(npc_smithy_good(&t.world, t.city()), Good::Tools);
    let tools = npc_tools_wanted(&t.world, t.city());
    t.world.buildings[s].stock.get_or_insert_with(Stock::new).insert(Good::Tools, tools);
    assert_eq!(npc_smithy_good(&t.world, t.city()), Good::Spear, "nothing lacking: its kit");
    // One of its soldiers unarmed comes first.
    let i = t.adults()[0];
    t.world.residents[i].carried.clear();
    crate::equipment::settle_equipment(&mut t.world.residents[i]);
    t.world.buildings[s].stock.get_or_insert_with(Stock::new).shift_remove(&Good::Bow);
    t.world.buildings[s].stock.get_or_insert_with(Stock::new).shift_remove(&Good::Arrows);
    assert_eq!(npc_smithy_good(&t.world, t.city()), Good::Spear);
}

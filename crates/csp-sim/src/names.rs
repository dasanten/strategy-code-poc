//! Game-given names (`apps/server/src/names.ts`, `CONTEXT.md`: Game-given names): a name the game
//! gives a resident is one no living resident of that realm has, an NPC city counting as a realm;
//! a name it gives a city is one no city in the world has. When its list runs dry it adds a
//! numeral ("Edda II") rather than repeating one. Players' renames stay free and may make
//! duplicates.
//!
//! Not to be confused with [`crate::queries::names`], the TypeScript strings of goods and kinds.

use std::collections::{HashMap, HashSet};

use csp_shared::world::WorldState;

use crate::sight::InvariantViolation;

const ROMAN: [(u32, &str); 13] = [
    (1000, "M"),
    (900, "CM"),
    (500, "D"),
    (400, "CD"),
    (100, "C"),
    (90, "XC"),
    (50, "L"),
    (40, "XL"),
    (10, "X"),
    (9, "IX"),
    (5, "V"),
    (4, "IV"),
    (1, "I"),
];

/// `n` in Roman numerals, for the second, third, … of one name: 2 is "II" (`numeral`).
pub fn numeral(mut n: u32) -> String {
    let mut out = String::new();
    for (value, letters) in ROMAN {
        while n >= value {
            out.push_str(letters);
            n -= value;
        }
    }
    out
}

/// A name without the numeral the game may have added to it: "Edda II" is "Edda" (`baseName`,
/// the regex `/ [IVXLCDM]+$/`).
pub fn base_name(name: &str) -> &str {
    if let Some(space) = name.rfind(' ') {
        let tail = &name[space + 1..];
        if !tail.is_empty() && tail.chars().all(|c| "IVXLCDM".contains(c)) {
            return &name[..space];
        }
    }
    name
}

/// A name `taken` doesn't hold, for the game to give (`uniqueName`): `drawn` if it is free, else
/// the next free name of `pool` after it (wrapping round), else `drawn` with the lowest numeral
/// that is free ("Edda II", "Edda III", …). Needs no randomness, so a seeded world names things
/// alike.
pub fn unique_name(drawn: &str, taken: &HashSet<String>, pool: &[&str]) -> String {
    if !taken.contains(drawn) {
        return drawn.to_string();
    }
    // `pool.indexOf(drawn)`: -1 when it is not in the list, so the search starts at its head.
    let start = pool.iter().position(|n| *n == drawn).map_or(-1, |i| i as i64);
    let len = pool.len() as i64;
    for i in 1..=len {
        let name = pool[((start + i) % len) as usize];
        if !taken.contains(name) {
            return name.to_string();
        }
    }
    let base = base_name(drawn);
    (2..)
        .map(|n| format!("{base} {}", numeral(n)))
        .find(|name| !taken.contains(name))
        .expect("some numeral is free")
}

/// Whether a resident belongs to the realm of `owner`, or for no realm to the NPC city `city_id`
/// (`sameRealm`).
fn same_realm(
    r_owner: Option<&str>,
    r_city: Option<&str>,
    owner: Option<&str>,
    city_id: Option<&str>,
) -> bool {
    match owner {
        Some(_) => r_owner == owner,
        None => r_owner.is_none() && r_city == city_id,
    }
}

/// The names of the living residents of the realm a resident of `owner` living in `city_id`
/// belongs to (`residentNamesTaken`): the Player's realm, or for one of no realm the NPC city they
/// live in. One of no realm and no city shares a realm with nobody.
pub fn resident_names_taken(
    world: &WorldState,
    owner: Option<&str>,
    city_id: Option<&str>,
) -> HashSet<String> {
    if owner.is_none() && city_id.is_none() {
        return HashSet::new();
    }
    world
        .residents
        .iter()
        .filter(|r| {
            r.health > 0.0 && same_realm(r.owner.as_deref(), r.city_id.as_deref(), owner, city_id)
        })
        .map(|r| r.name.clone())
        .collect()
}

/// The names of every city in the world (`cityNamesTaken`).
pub fn city_names_taken(world: &WorldState) -> HashSet<String> {
    world.cities.iter().map(|c| c.name.clone()).collect()
}

/// Invariant `game-names-unique` (ADR 0004; `CONTEXT.md`: Game-given names): no two living
/// residents of one realm, an NPC city counting as one, share a name the game gave them and nobody
/// renamed (`gameName`).
pub fn game_names_unique(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let mut seen: HashMap<String, &str> = HashMap::new();
    for r in &world.residents {
        if r.game_name != Some(true) || r.health <= 0.0 {
            continue;
        }
        if r.owner.is_none() && r.city_id.is_none() {
            continue;
        }
        let realm = match (&r.owner, &r.city_id) {
            (Some(owner), _) => owner.clone(),
            (None, Some(city)) => format!("city:{city}"),
            (None, None) => unreachable!("skipped above"),
        };
        let key = format!("{realm}|{}", r.name);
        match seen.get(&key) {
            None => {
                seen.insert(key, &r.id);
            }
            Some(other) => out.push(InvariantViolation {
                invariant: "game-names-unique".into(),
                message: format!(
                    "residents {other} and {} of one realm both have the game's name {}",
                    r.id, r.name
                ),
                entity_ids: vec![other.to_string(), r.id.clone()],
            }),
        }
    }
    out
}

/// Invariant `city-game-names-unique` (ADR 0004; `CONTEXT.md`: Game-given names): no two cities
/// share a name the game gave them and nobody renamed (`gameName`).
pub fn city_game_names_unique(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let mut seen: HashMap<&str, &str> = HashMap::new();
    for c in &world.cities {
        if c.game_name != Some(true) {
            continue;
        }
        match seen.get(c.name.as_str()) {
            None => {
                seen.insert(&c.name, &c.id);
            }
            Some(other) => out.push(InvariantViolation {
                invariant: "city-game-names-unique".into(),
                message: format!(
                    "cities {other} and {} both have the game's name {}",
                    c.id, c.name
                ),
                entity_ids: vec![other.to_string(), c.id.clone()],
            }),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::random::Mulberry32;
    use crate::residents::{new_resident, NewResident};
    use crate::test_support::world_with_city;
    use csp_shared::world::Resident;

    fn set(names: &[&str]) -> HashSet<String> {
        names.iter().map(|n| n.to_string()).collect()
    }

    #[test]
    fn keeps_a_free_name_else_takes_the_next_free_one_else_adds_a_numeral() {
        let pool = ["Edda", "Bram", "Wren"];
        assert_eq!(unique_name("Bram", &set(&["Edda"]), &pool), "Bram");
        assert_eq!(unique_name("Bram", &set(&["Bram"]), &pool), "Wren");
        assert_eq!(unique_name("Wren", &set(&["Wren", "Edda"]), &pool), "Bram");
        assert_eq!(unique_name("Edda", &set(&pool), &pool), "Edda II");
        let mut more = set(&pool);
        more.extend(set(&["Edda II", "Edda III"]));
        assert_eq!(unique_name("Edda", &more, &pool), "Edda IV");
        // Without a list, as for a resident joining a realm: straight to the numeral.
        assert_eq!(unique_name("Edda II", &set(&["Edda II"]), &[]), "Edda III");
    }

    #[test]
    fn writes_numerals_the_roman_way() {
        let got: Vec<String> = [2, 3, 4, 9, 14, 40, 1999].into_iter().map(numeral).collect();
        assert_eq!(got, ["II", "III", "IV", "IX", "XIV", "XL", "MCMXCIX"]);
        assert_eq!(base_name("Edda XIV"), "Edda");
        assert_eq!(base_name("Ivo"), "Ivo");
    }

    // Not ported here: the tests of `names.test.ts` that found starting cities, NPC cities and
    // town-hall cities, pair residents for a child, join a realm or rename by order. They test
    // `foundStartingCity` (T86.8), `foundNpcCity` (T86.10), `foundCity`, `joinRealm` (T86.7),
    // births (T86.8) and the rename orders (T86.2) giving names through `unique_name`, and come
    // with those tickets.

    fn npc(id: &str, city_id: Option<&str>) -> Resident {
        let mut m = Mulberry32::new(1.0);
        let fields = NewResident { id, owner: None, city_id, x: 1.0, y: 1.0, tick: 0.0 };
        let mut r = new_resident(&mut || m.next(), &fields, None);
        r.name = "Ivo".into();
        r.game_name = Some(true);
        r
    }

    #[test]
    fn reports_two_living_residents_of_one_realm_or_npc_city_with_one_game_name() {
        let (mut world, _) = world_with_city();
        let a = world.residents[0].clone();
        world.residents[1].name = a.name.clone();
        let b_id = world.residents[1].id.clone();
        let v = game_names_unique(&world);
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].invariant, "game-names-unique");
        assert_eq!(v[0].entity_ids, [a.id.clone(), b_id.clone()]);
        // Not once one of them is dead, or renamed.
        world.residents[1].health = 0.0;
        assert_eq!(game_names_unique(&world), []);
        world.residents[1].health = 10.0;
        world.residents[1].game_name = None;
        assert_eq!(game_names_unique(&world), []);

        // Residents of no realm share one with those of the NPC city they live in only.
        world.residents.extend([
            npc("n1", Some("c1")),
            npc("n2", Some("c2")),
            npc("n3", None),
            npc("n4", None),
        ]);
        assert_eq!(game_names_unique(&world), []);
        world.residents.push(npc("n5", Some("c1")));
        let v = game_names_unique(&world);
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].entity_ids, ["n1", "n5"]);
    }

    #[test]
    fn reports_two_cities_with_one_game_name_not_one_the_player_gave() {
        let (mut world, _) = world_with_city();
        let mut twin = world.cities[0].clone();
        twin.id = "twin".into();
        world.cities.push(twin);
        let v = city_game_names_unique(&world);
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].invariant, "city-game-names-unique");
        assert_eq!(v[0].entity_ids, [world.cities[0].id.clone(), "twin".to_string()]);
        world.cities[1].game_name = None;
        assert_eq!(city_game_names_unique(&world), []);
    }

    #[test]
    fn takes_the_names_of_a_realm_or_npc_city_living_residents() {
        let (mut world, _) = world_with_city();
        let realm = world.realms[0].id.clone();
        let names: HashSet<String> = world.residents.iter().map(|r| r.name.clone()).collect();
        assert_eq!(resident_names_taken(&world, Some(&realm), None), names);
        world.residents.extend([npc("n1", Some("c1")), npc("n2", None)]);
        assert_eq!(resident_names_taken(&world, None, Some("c1")), set(&["Ivo"]));
        assert_eq!(resident_names_taken(&world, None, None), HashSet::new());
        assert_eq!(city_names_taken(&world), set(&[world.cities[0].name.as_str()]));
    }
}

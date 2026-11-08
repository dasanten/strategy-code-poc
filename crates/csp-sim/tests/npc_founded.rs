//! NPC cities come to be as in TypeScript (`find_npc_city_site`, `found_npc_city`,
//! `give_npc_horses`): `src/npc/founded.json`, written by `src/npc/gen-expected.mts`, holds a town
//! and two villages founded on the 7-1024 fixture map, with their layouts, residents, horses and the
//! horses' Food.

mod common;

use csp_shared::balance::{NPC_TOWN, NPC_VILLAGE};
use csp_shared::terrain::TerrainMap;
use csp_sim::npc_cities::{find_npc_city_site, found_npc_city, give_npc_horses};
use csp_sim::random::Mulberry32;
use csp_sim::world::create_world;
use serde_json::{json, Value};

use common::{assert_same_json, fixtures};

#[test]
fn founds_npc_cities_as_typescript_does() {
    let want: Value =
        serde_json::from_str(include_str!("../src/npc/founded.json")).expect("founded.json");
    let tiles = std::fs::read(fixtures().join("terrain/7-1024.bin")).expect("the map");
    let terrain = TerrainMap { size: 1024, tiles };
    let mut world = create_world(&terrain, 7);
    let mut m = Mulberry32::new(f64::from(7 * 104_729 + 31));
    let mut rand = || m.next();
    let mut sites = Vec::new();
    for kind in [NPC_TOWN, NPC_VILLAGE, NPC_VILLAGE] {
        let site = find_npc_city_site(&world, &terrain, &kind, &mut rand);
        sites.push(site.map_or(Value::Null, |(x, y)| json!([x, y])));
        let Some((x, y)) = site else { continue };
        let city = found_npc_city(&mut world, &terrain, &kind, x, y, &mut rand, None);
        give_npc_horses(&mut world, &terrain, &city);
    }
    let got = json!({
        "sites": sites,
        "cities": world.cities,
        "buildings": world.buildings,
        "residents": world.residents,
        "horses": world.horses,
        "piles": world.piles,
        "nextId": world.next_id,
    });
    assert_same_json("founded", &want, &got);
}

//! The client's world mirror answers as the world does (T122.4, ADR 0045): for the fixture worlds
//! and each realm in them, a mirror built from what the server sends that realm (`sight.rs`, with
//! every tile in sight) gives each rule the client has a twin of the answer the full world gives.
//! A rule that reads something no Player is sent may answer otherwise: it is named in `DIFFERS`
//! with the answer the mirror gives, as `docs/wasm-rules.md` lists it.

mod common;

use std::collections::{BTreeMap, HashSet};

use common::load_world;
use csp_shared::world::WorldState;
use csp_sim::mirror::SightMirror;
use csp_sim::queries::{
    army, building, carriages, city, city_area, direct_offer, goods, horses, npc_trade, people,
    riding, trade_org, transfer, walls, warehouse_trade,
};
use csp_sim::sight::entities_revealed;
use csp_sim::world_index::WorldIndex;

const FIXTURES: &[&str] =
    &["sight/city.json", "sight/two-realms.json", "sight/three-realms.json", "sight/visitors.json"];

/// What a rule answers about one thing or tile, as text.
type Rule = fn(&WorldState, i32, &Ask) -> Vec<String>;

/// What the rules are asked about: every tile on and next to a building, resident, carriage and
/// horse of the full world, and every city, building, carriage, horse and resident by id.
struct Ask {
    tiles: Vec<(i32, i32)>,
    city_ids: Vec<String>,
    building_ids: Vec<String>,
    carriage_ids: Vec<String>,
    horse_ids: Vec<String>,
    resident_ids: Vec<String>,
    realm_ids: Vec<String>,
}

fn ids<'w>(xs: impl Iterator<Item = Option<&'w str>>) -> Vec<String> {
    xs.map(|x| x.unwrap_or("-").to_string()).collect()
}

/// Each rule over every tile or id it takes.
fn rules() -> Vec<(&'static str, Rule)> {
    vec![
        ("buildingAt", |w, s, a| {
            ids(a
                .tiles
                .iter()
                .map(|&(x, y)| building::building_at(w, x, y, s).map(|b| b.id.as_str())))
        }),
        ("pileTile", |w, s, a| {
            a.tiles.iter().map(|&(x, y)| format!("{:?}", building::pile_tile(w, x, y, s))).collect()
        }),
        ("roadAt", |w, _, a| {
            ids(a.tiles.iter().map(|&(x, y)| building::road_at(w, x, y).map(|b| b.id.as_str())))
        }),
        ("carriageSiteAt", |w, _, a| {
            ids(a
                .tiles
                .iter()
                .map(|&(x, y)| building::carriage_site_at(w, x, y).map(|b| b.id.as_str())))
        }),
        ("boatSiteAt", |w, _, a| {
            ids(a
                .tiles
                .iter()
                .map(|&(x, y)| building::boat_site_at(w, x, y).map(|b| b.id.as_str())))
        }),
        ("stableFor", |w, s, a| {
            ids(a
                .tiles
                .iter()
                .map(|&(x, y)| building::stable_for(w, x, y, s).map(|b| b.id.as_str())))
        }),
        ("roadTiles", |w, s, _| {
            let mut tiles: Vec<usize> = building::road_tiles(w, s).into_iter().collect();
            tiles.sort_unstable();
            vec![format!("{tiles:?}")]
        }),
        ("storageAt", |w, s, a| {
            ids(a.tiles.iter().map(|&(x, y)| goods::storage_at(w, x, y, s).map(|b| b.id.as_str())))
        }),
        ("pileAt", |w, _, a| {
            ids(a.tiles.iter().map(|&(x, y)| {
                goods::pile_at(w, f64::from(x), f64::from(y)).map(|p| p.id.as_str())
            }))
        }),
        ("tradingWarehouseAt", |w, _, a| {
            ids(a.tiles.iter().map(|&(x, y)| {
                warehouse_trade::trading_warehouse_at(w, f64::from(x), f64::from(y))
                    .map(|b| b.id.as_str())
            }))
        }),
        ("cityIdsAt", |w, s, a| {
            a.tiles
                .iter()
                .map(|&(x, y)| {
                    format!("{:?}", city_area::city_ids_at(w, f64::from(x), f64::from(y), s))
                })
                .collect()
        }),
        ("inCityArea", |w, s, a| {
            a.city_ids
                .iter()
                .flat_map(|c| {
                    a.tiles.iter().map(move |&(x, y)| {
                        city_area::in_city_area(w, c, f64::from(x), f64::from(y), s).to_string()
                    })
                })
                .collect()
        }),
        ("cityAreaTiles", |w, s, a| {
            a.city_ids
                .iter()
                .map(|c| city_area::city_area_tiles(w, c, s).len().to_string())
                .collect()
        }),
        ("housingRoom", |w, _, a| {
            a.city_ids.iter().map(|c| city_area::housing_room(w, c).to_string()).collect()
        }),
        ("freeHousing", |w, _, a| {
            a.city_ids.iter().map(|c| city_area::free_housing(w, c).to_string()).collect()
        }),
        ("storedFood", |w, _, a| {
            a.city_ids.iter().map(|c| city_area::stored_food(w, c).to_string()).collect()
        }),
        ("townHallOf", |w, _, a| {
            ids(w
                .cities
                .iter()
                .filter(|c| a.city_ids.contains(&c.id))
                .map(|c| city::town_hall_of(w, c).map(|b| b.id.as_str())))
        }),
        ("cityResidents", |w, _, a| {
            a.city_ids.iter().map(|c| format!("{:?}", names(city::city_residents(w, c)))).collect()
        }),
        ("relocatingTo", |w, _, a| {
            a.city_ids.iter().map(|c| format!("{:?}", names(people::relocating_to(w, c)))).collect()
        }),
        ("deliveryStorage", |w, _, a| {
            ids(a
                .city_ids
                .iter()
                .map(|c| warehouse_trade::delivery_storage(w, c).map(|b| b.id.as_str())))
        }),
        ("buildingRealm", |w, _, a| {
            ids(w
                .buildings
                .iter()
                .filter(|b| a.building_ids.contains(&b.id))
                .map(|b| city::building_realm(w, b)))
        }),
        ("workersOf", |w, _, a| {
            w.buildings
                .iter()
                .filter(|b| a.building_ids.contains(&b.id))
                .map(|b| format!("{:?}", names(building::workers_of(w, b))))
                .collect()
        }),
        ("holdersOf", |w, _, a| {
            w.buildings
                .iter()
                .filter(|b| a.building_ids.contains(&b.id))
                .map(|b| format!("{:?}", building::holders_of(w, b)))
                .collect()
        }),
        ("inputAt", |w, _, a| {
            w.buildings
                .iter()
                .filter(|b| a.building_ids.contains(&b.id))
                .map(|b| format!("{:?}", building::input_at(w, b)))
                .collect()
        }),
        ("driverOf", |w, _, a| {
            ids(a.carriage_ids.iter().map(|k| carriages::driver_of(w, k).map(|r| r.id.as_str())))
        }),
        ("passengersOf", |w, _, a| {
            a.carriage_ids
                .iter()
                .map(|k| format!("{:?}", names(carriages::passengers_of(w, k))))
                .collect()
        }),
        ("horseFor", |w, _, a| {
            ids(w
                .carriages
                .iter()
                .filter(|k| a.carriage_ids.contains(&k.id))
                .map(|k| carriages::horse_for(w, k).map(|h| h.id.as_str())))
        }),
        ("standsStill", |w, _, a| {
            w.carriages
                .iter()
                .filter(|k| a.carriage_ids.contains(&k.id))
                .map(|k| carriages::stands_still(w, k).to_string())
                .collect()
        }),
        ("carriageCapacity", |w, _, a| {
            w.carriages
                .iter()
                .filter(|k| a.carriage_ids.contains(&k.id))
                .map(|k| carriages::carriage_capacity(w, k).to_string())
                .collect()
        }),
        ("goodsCapacity", |w, _, a| {
            w.carriages
                .iter()
                .filter(|k| a.carriage_ids.contains(&k.id))
                .map(|k| goods::goods_capacity(w, k).to_string())
                .collect()
        }),
        ("carriagePulledBy", |w, _, a| {
            ids(a
                .horse_ids
                .iter()
                .map(|h| carriages::carriage_pulled_by(w, h).map(|k| k.id.as_str())))
        }),
        ("riderOf", |w, _, a| {
            ids(a.horse_ids.iter().map(|h| horses::rider_of(w, h).map(|r| r.id.as_str())))
        }),
        ("horseRidden", |w, _, a| {
            ids(w
                .residents
                .iter()
                .filter(|r| a.resident_ids.contains(&r.id))
                .map(|r| riding::horse_ridden(w, r).map(|h| h.id.as_str())))
        }),
        ("armyOf", |w, _, a| {
            ids(a.resident_ids.iter().map(|r| army::army_of(w, r).map(|x| x.id.as_str())))
        }),
        ("onOwnWall", |w, _, a| {
            w.residents
                .iter()
                .filter(|r| a.resident_ids.contains(&r.id))
                .map(|r| walls::on_own_wall(w, r).to_string())
                .collect()
        }),
        ("npcStorages", |w, _, a| {
            w.cities
                .iter()
                .filter(|c| a.city_ids.contains(&c.id))
                .map(|c| {
                    format!(
                        "{:?}",
                        npc_trade::npc_storages(w, c).iter().map(|b| &b.id).collect::<Vec<_>>()
                    )
                })
                .collect()
        }),
        ("npcCityStock", |w, _, a| {
            w.cities
                .iter()
                .filter(|c| a.city_ids.contains(&c.id))
                .map(|c| format!("{:?}", npc_trade::npc_city_stock(w, c)))
                .collect()
        }),
        ("citiesToCarryAt", |w, _, a| {
            a.realm_ids
                .iter()
                .map(|r| {
                    format!(
                        "{:?}",
                        direct_offer::cities_to_carry_at(w, r)
                            .iter()
                            .map(|c| &c.id)
                            .collect::<Vec<_>>()
                    )
                })
                .collect()
        }),
        ("tradeOrgHq", |w, _, _| vec![format!("{:?}", trade_org::trade_org_hq(w).map(|c| &c.id))]),
        ("transferWarehouses", |w, _, _| {
            vec![format!(
                "{:?}",
                transfer::transfer_warehouses(w).iter().map(|b| &b.id).collect::<Vec<_>>()
            )]
        }),
    ]
}

/// The rules that may answer otherwise on what a Player is sent, and what the mirror answers.
const DIFFERS: &[(&str, &str)] = &[
    // A building's stock is sent only to those who see inside it (`seen_building`): another's
    // reads as empty, so their workplace's input and an NPC city's stock read as none.
    ("inputAt", "a workplace not seen inside: none of the input in its stock"),
    ("npcCityStock", "a storage not seen inside: nothing in it"),
    ("storedFood", "a storage not seen inside: no Food in it"),
];

fn names(rs: Vec<&csp_shared::world::Resident>) -> Vec<&str> {
    rs.into_iter().map(|r| r.id.as_str()).collect()
}

fn ask(world: &WorldState) -> Ask {
    let mut tiles = HashSet::new();
    let spots = world
        .buildings
        .iter()
        .map(|b| (b.x, b.y))
        .chain(world.residents.iter().map(|r| (r.x, r.y)))
        .chain(world.carriages.iter().map(|k| (k.x, k.y)))
        .chain(world.horses.iter().map(|h| (h.x, h.y)));
    for (x, y) in spots {
        for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1), (-1, 0), (2, 2)] {
            tiles.insert((x as i32 + dx, y as i32 + dy));
        }
    }
    let mut tiles: Vec<_> = tiles.into_iter().collect();
    tiles.sort_unstable();
    Ask {
        tiles,
        city_ids: world.cities.iter().map(|c| c.id.clone()).collect(),
        building_ids: world.buildings.iter().map(|b| b.id.clone()).collect(),
        carriage_ids: world.carriages.iter().map(|k| k.id.clone()).collect(),
        horse_ids: world.horses.iter().map(|h| h.id.clone()).collect(),
        resident_ids: world.residents.iter().map(|r| r.id.clone()).collect(),
        realm_ids: world.realms.iter().map(|r| r.id.clone()).collect(),
    }
}

#[test]
fn the_mirror_answers_each_rule_as_the_full_world_where_the_player_sees_what_it_reads() {
    let documented: BTreeMap<&str, &str> = DIFFERS.iter().copied().collect();
    let mut differed: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut asked = 0;
    for path in FIXTURES {
        let (world, size, _) = load_world(path);
        let index = WorldIndex::new(&world, size);
        let questions = ask(&world);
        for realm in &world.realms {
            let mut mirror = SightMirror::new();
            let seen = entities_revealed(&world, &index, &realm.id);
            mirror.welcome(size, seen.iter().cloned());
            let (m, w) = (mirror.world(), &world);
            assert_eq!(
                (m.residents.len(), m.buildings.len(), m.cities.len(), m.carriages.len()),
                (w.residents.len(), w.buildings.len(), w.cities.len(), w.carriages.len()),
                "{path} {}: the mirror holds what the realm sees, all of it",
                realm.id
            );
            for (name, rule) in rules() {
                asked += 1;
                let full = rule(&world, size, &questions);
                let mirrored = rule(mirror.world(), size, &questions);
                if full != mirrored {
                    differed
                        .entry(name.to_string())
                        .or_default()
                        .push(format!("{path} {}", realm.id));
                }
            }
        }
    }
    assert!(asked > 0, "no fixture asked anything");
    let undocumented: Vec<_> =
        differed.iter().filter(|(name, _)| !documented.contains_key(name.as_str())).collect();
    assert!(
        undocumented.is_empty(),
        "rules that answer otherwise on the mirror and aren't in DIFFERS: {undocumented:?}"
    );
}

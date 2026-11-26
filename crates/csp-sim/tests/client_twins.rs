//! The rules the client keeps in TypeScript beside the wasm module (T122.8, ADR 0045): small
//! predicates and lookups it asks per frame, per tile or per row, where a call into the module
//! would cost more than the rule. Each is held to its Rust original here: for two fixture worlds,
//! as a realm is sent them (`entities_revealed`), each original answers the cases below on the
//! mirror of what was sent, and `client_twins.json` keeps the entities, the cases and the answers.
//! `apps/web/src/client-twins.test.ts` asks the TypeScript the same cases of the same entities and
//! fails on any answer that differs; this test fails when the file is not what the originals
//! answer now. Write it again with `CSP_WRITE_TWINS=1 cargo nextest run -p csp-sim client_twins`.
//!
//! A twin is one line in `twins()` here and one in the TypeScript test; ESLint
//! (`csp/no-rule-copy`) refuses a client function named after a `queries/` function that is not
//! among them.

mod common;

use std::collections::HashSet;

use common::{normalised, read_json};
use csp_shared::footprint::{covers, footprint_tiles, is_at, Placed};
use csp_shared::protocol::SeenEntity;
use csp_shared::terrain::{
    is_passable_terrain, is_water, tile_index, wrap, wrap_delta, wrap_distance,
};
use csp_shared::world::{
    BuildingKind, Good, Patch, Richness, Stock, TradeSide, WallMaterial, WorldState,
};
use csp_sim::equipment::{equipped, Slot};
use csp_sim::mirror::SightMirror;
use csp_sim::queries::names::kind_name;
use csp_sim::queries::people::FirstDay;
use csp_sim::queries::warehouse_trade::TradeHolder;
use csp_sim::queries::{
    army, breeding, building, carriages, city, city_area, direct_offer, driving, guard, horses,
    offers, people, persuasion, residents, riding, trade_quotes, transfer, vessels, walls,
    warehouse, warehouse_trade,
};
use csp_sim::sight::entities_revealed;
use csp_sim::world_index::WorldIndex;
use serde_json::{json, Value};

/// Where the cases and answers are kept, for the TypeScript test to read.
const OUT: &str = "tests/client_twins.json";

/// A world as one realm is sent it, and the mirror of what it was sent.
struct Sent {
    name: &'static str,
    size: i32,
    realm: String,
    seen: Vec<SeenEntity>,
    mirror: SightMirror,
}

impl Sent {
    fn w(&self) -> &WorldState {
        self.mirror.world()
    }

    /// The carriages whose load the realm is sent.
    fn loads_seen(&self) -> HashSet<&str> {
        self.seen
            .iter()
            .filter_map(|e| match e {
                SeenEntity::Carriage(k) if k.load.is_some() => Some(k.id.as_str()),
                _ => None,
            })
            .collect()
    }

    /// Tiles on and around each building, resident and vessel, for the rules asked of a tile.
    fn tiles(&self) -> Vec<(i32, i32)> {
        let w = self.w();
        let spots = w
            .buildings
            .iter()
            .map(|b| (b.x as i32, b.y as i32))
            .chain(w.residents.iter().map(|r| (r.x as i32, r.y as i32)))
            .chain(w.vessels.iter().map(|v| (v.x as i32, v.y as i32)));
        let mut out: Vec<(i32, i32)> = spots
            .flat_map(|(x, y)| [(x, y), (x + 1, y), (x - 1, y + 1), (x + 2, y + 2)])
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        out.sort_unstable();
        out
    }
}

/// The additions to `sight/two-realms.json` so every twin has something to answer about: an army
/// with a supply wagon, a haul route, a teacher and trainee, a breeding pair, a rider, the Down, a
/// ruin, a stone wall, gear, an offer, a boat and a ship at a haven.
fn more_of_two_realms(world: &mut Value) {
    let residents = world["residents"].as_array_mut().unwrap();
    let ids: Vec<String> =
        residents.iter().map(|r| r["id"].as_str().unwrap().to_string()).collect();
    let set = |rs: &mut Vec<Value>, id: &str, f: &dyn Fn(&mut Value)| {
        f(rs.iter_mut().find(|r| r["id"] == id).unwrap())
    };
    // realm1's residents are the first eight, realm134's the next eight.
    let [a, b, c, d, e, f, g, h] = std::array::from_fn(|i| ids[i].clone());
    let other = ids[8].clone();
    set(residents, &a, &|r| {
        r["carried"] = json!({ "food": 2, "sword": 1, "shield": 1 });
        r["equipped"] = json!({ "weapon": "sword", "shield": "shield" });
        r["order"] = json!({ "kind": "drive", "carriageId": "carriage132",
            "target": { "x": 260, "y": 1272 }, "path": null, "progress": 0, "army": "army900" });
    });
    set(residents, &b, &|r| {
        r["carried"] = json!({ "spear": 1 });
        r["equipped"] = json!({ "weapon": "spear" });
        r["skills"] = json!({ "combat": 40 });
        r["riding"] = json!("horse130");
    });
    set(residents, &c, &|r| {
        r["x"] = json!(270);
        r["y"] = json!(1262);
        r["order"] = json!({ "kind": "teach", "buildingId": "b900", "subject": "mining" });
        r["skills"] = json!({ "mining": 80 });
    });
    set(residents, &d, &|r| {
        r["x"] = json!(271);
        r["y"] = json!(1263);
        r["order"] = json!({ "kind": "train", "buildingId": "b900", "learning": null });
    });
    set(residents, &e, &|r| r["downUntil"] = json!(100000));
    set(residents, &f, &|r| {
        r["x"] = json!(262);
        r["y"] = json!(1281);
    });
    set(residents, &g, &|r| {
        r["carrying"] = json!({ "since": 0, "partnerId": h, "partnerName": "Partner",
            "partnerBase": { "strength": 10, "endurance": 10, "agility": 10, "intellect": 10 } })
    });
    set(residents, &other, &|r| {
        r["order"] = json!({ "kind": "haul", "carriageId": "carriage265",
            "from": { "x": 0, "y": 0 }, "to": { "x": 4, "y": 4 }, "toArmy": "army900",
            "goods": ["food"], "returnGoods": [], "keepFood": 3, "stop": "to",
            "phase": "driving", "path": null, "progress": 0, "moving": null });
    });
    for k in world["carriages"].as_array_mut().unwrap() {
        k["load"] = json!({ "food": 10, "wood": 4 });
    }
    world["horses"][1]["downUntil"] = json!(100000);
    let buildings = world["buildings"].as_array_mut().unwrap();
    let storage = buildings.iter_mut().find(|b| b["kind"] == "storage").unwrap();
    storage["stock"] = json!({ "food": 30, "wood": 12 });
    let storage_at = (storage["id"].clone(), storage["x"].clone(), storage["y"].clone());
    let wall = buildings.iter_mut().find(|b| b["kind"] == "wall").unwrap();
    wall["material"] = json!("stone");
    buildings.iter_mut().find(|b| b["kind"] == "house").unwrap()["ruinedAt"] = json!(0);
    buildings.push(json!({ "id": "b900", "kind": "trainingGround", "cityId": "city2",
        "x": 270, "y": 1262 }));
    buildings.push(json!({ "id": "b901", "kind": "haven", "cityId": "city2", "x": 262,
        "y": 1281 }));
    world["armies"] = json!([{ "id": "army900", "name": "First", "realmId": "realm1",
        "memberIds": [a, b], "order": null }]);
    world["offers"] = json!([{ "id": "offer900", "realmId": "realm1", "storageId": storage_at.0,
        "x": storage_at.1, "y": storage_at.2, "gives": "food", "givesUnits": 4, "wants": "wood",
        "wantsUnits": 2, "times": 3 }]);
    world["vessels"] = json!([
        { "id": "boat900", "kind": "boat", "realmId": "realm1", "x": 258, "y": 1276,
          "load": { "food": 5 } },
        { "id": "ship901", "kind": "ship", "realmId": "realm1", "x": 262, "y": 1281,
          "load": { "wood": 20 }, "crewIds": [f] },
    ]);
    let buildings = world["buildings"].as_array_mut().unwrap();
    buildings.push(json!({ "id": "b902", "kind": "road", "cityId": null, "x": 250, "y": 1266 }));
    // A breeding pair of realm1's at its stable.
    let stable = buildings.iter().find(|b| b["kind"] == "stable" && b["cityId"] == "city2");
    let (sx, sy) = stable.map(|b| (b["x"].clone(), b["y"].clone())).unwrap();
    let stable_id = stable.unwrap()["id"].clone();
    let pair: Vec<Value> = world["horses"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|x| x["realmId"] == "realm1")
        .map(|x| x["id"].clone())
        .take(2)
        .collect();
    let breeder = world["residents"].as_array_mut().unwrap().iter_mut().find(|r| r["id"] == h);
    let breeder = breeder.unwrap();
    breeder["x"] = sx.clone();
    breeder["y"] = sy.clone();
    breeder["order"] = json!({ "kind": "breed", "stableId": stable_id, "horseIds": pair,
        "at": { "x": sx, "y": sy }, "progress": 0 });
}

fn sent() -> Vec<Sent> {
    let worlds: [(&str, &str, Option<fn(&mut Value)>); 2] = [
        ("two-realms", "sight/two-realms.json", Some(more_of_two_realms)),
        ("transfers", "trade/transfers.json", None),
    ];
    worlds
        .into_iter()
        .map(|(name, path, more)| {
            let mut v = read_json(path);
            let size = v["size"].as_i64().expect("a size") as i32;
            if let Some(more) = more {
                more(&mut v["world"]);
            }
            let world: WorldState =
                serde_json::from_value(v["world"].take()).unwrap_or_else(|e| panic!("{path}: {e}"));
            let realm = world.realms[0].id.clone();
            let index = WorldIndex::new(&world, size);
            let seen = entities_revealed(&world, &index, &realm).to_vec();
            let mut mirror = SightMirror::new();
            mirror.welcome(size, world.tick, seen.iter().cloned());
            Sent { name, size, realm, seen, mirror }
        })
        .collect()
}

/// One case: what the twin is asked, and what the original answers.
type Case = (Value, Value);
type Twin = fn(&Sent) -> Vec<Case>;

fn id<T: serde::Serialize>(x: Option<T>) -> Value {
    json!(x)
}

fn ids<'a>(xs: impl IntoIterator<Item = &'a str>) -> Value {
    json!(xs.into_iter().collect::<Vec<_>>())
}

/// Each twin, by the TypeScript's name, and its cases.
fn twins() -> Vec<(&'static str, Twin)> {
    vec![
        // Armies and carriages.
        ("armyDrivenTo", |s| {
            s.w().residents.iter().map(|r| (json!([r.id]), id(army::army_driven_to(r)))).collect()
        }),
        ("spareFood", |s| {
            let seen = s.loads_seen();
            let w = s.w();
            let loaded = w.carriages.iter().filter(|k| seen.contains(k.id.as_str()));
            loaded.map(|k| (json!([k.id]), json!(army::spare_food(w, k)))).collect()
        }),
        ("carriageCapacity", |s| {
            let w = s.w();
            w.carriages
                .iter()
                .map(|k| (json!([k.id]), json!(carriages::carriage_capacity(w, k))))
                .collect()
        }),
        ("horseFor", |s| {
            let w = s.w();
            w.carriages
                .iter()
                .map(|k| (json!([k.id]), id(carriages::horse_for(w, k).map(|h| &h.id))))
                .collect()
        }),
        ("carriagePulledBy", |s| {
            let w = s.w();
            w.horses
                .iter()
                .map(|h| {
                    (json!([h.id]), id(carriages::carriage_pulled_by(w, &h.id).map(|k| &k.id)))
                })
                .collect()
        }),
        ("hitchHorseProblem", |s| {
            let w = s.w();
            let mut out = Vec::new();
            for k in &w.carriages {
                for h in &w.horses {
                    out.push((json!([k.id, h.id]), id(carriages::hitch_horse_problem(w, k, h))));
                }
            }
            out
        }),
        ("crewIdsOf", |s| {
            let w = s.w();
            w.caravans
                .iter()
                .map(|c| {
                    let crew = carriages::crew_ids_of(c.driver_id.as_deref(), &c.escort_ids);
                    (json!([c.id]), json!(crew))
                })
                .collect()
        }),
        ("drivenCarriageId", |s| {
            let w = s.w();
            w.residents
                .iter()
                .map(|r| (json!([r.id]), id(carriages::driven_carriage_id(r))))
                .collect()
        }),
        ("carriageOfResident", |s| {
            let w = s.w();
            let mut out = Vec::new();
            for k in &w.carriages {
                for r in &w.residents {
                    let of = driving::carriage_of_resident(&k.realm_id, &k.city_id, r);
                    out.push((json!([k.id, r.id]), json!(of)));
                }
            }
            out
        }),
        // Buildings.
        ("holdersOf", |s| {
            let w = s.w();
            w.buildings.iter().map(|b| (json!([b.id]), json!(building::holders_of(w, b)))).collect()
        }),
        ("workersOf", |s| {
            let w = s.w();
            w.buildings
                .iter()
                .map(|b| {
                    (json!([b.id]), ids(building::workers_of(w, b).iter().map(|r| r.id.as_str())))
                })
                .collect()
        }),
        ("teacherAt", |s| {
            let w = s.w();
            w.buildings
                .iter()
                .map(|b| {
                    let t = building::teacher_at(b, &w.residents, s.size);
                    (json!([b.id]), id(t.map(|r| &r.id)))
                })
                .collect()
        }),
        ("traineesOf", |s| {
            let w = s.w();
            w.buildings
                .iter()
                .map(|b| {
                    let t = building::trainees_of(b, &w.residents, s.size);
                    (json!([b.id]), ids(t.iter().map(|r| r.id.as_str())))
                })
                .collect()
        }),
        ("takesWorkSettings", |s| {
            let w = s.w();
            w.buildings
                .iter()
                .map(|b| (json!([b.id]), json!(building::takes_work_settings(b))))
                .collect()
        }),
        ("isStone", |_| {
            let mut out = Vec::new();
            for &kind in BuildingKind::ALL {
                for m in [None, Some(WallMaterial::Wood), Some(WallMaterial::Stone)] {
                    out.push((json!([kind, m]), json!(building::is_stone(kind, m))));
                }
            }
            out
        }),
        ("recipeGood", |_| {
            let recipes = BuildingKind::ALL.iter().flat_map(|k| building::recipes_of(*k));
            recipes.map(|r| (json!([r]), json!(building::recipe_good(r)))).collect()
        }),
        ("roadLine", |s| {
            let ends = [((0, 0), (5, 5)), ((3, 2), (9, 4)), ((10, 10), (4, 7)), ((1, 1), (1, 1))];
            let far = [((2, 3), (s.size - 3, 5)), ((s.size - 1, 0), (2, s.size - 2))];
            ends.into_iter()
                .chain(far)
                .map(|(from, to)| (json!([from, to]), json!(building::road_line(from, to, s.size))))
                .collect()
        }),
        ("roadTiles", |s| {
            let mut tiles: Vec<usize> = building::road_tiles(s.w(), s.size).into_iter().collect();
            tiles.sort_unstable();
            vec![(json!([]), json!(tiles))]
        }),
        ("isWallOrGate", |s| {
            let w = s.w();
            w.buildings.iter().map(|b| (json!([b.id]), json!(walls::is_wall_or_gate(b)))).collect()
        }),
        ("isRuin", |s| {
            let w = s.w();
            w.buildings.iter().map(|b| (json!([b.id]), json!(csp_sim::ruins::is_ruin(b)))).collect()
        }),
        ("covers", |s| {
            let w = s.w();
            let tiles = s.tiles();
            let mut out = Vec::new();
            for b in w.buildings.iter().take(60) {
                let placed = Placed { kind: kind_name(b.kind), x: b.x as i32, y: b.y as i32 };
                let on: Vec<_> =
                    tiles.iter().filter(|&&(x, y)| covers(placed, x, y, s.size)).collect();
                out.push((json!([b.id]), json!(on)));
            }
            out
        }),
        ("buildingAt", |s| {
            let w = s.w();
            s.tiles()
                .into_iter()
                .map(|(x, y)| {
                    (json!([x, y]), id(building::building_at(w, x, y, s.size).map(|b| &b.id)))
                })
                .collect()
        }),
        // Cities.
        ("buildingRealm", |s| {
            let w = s.w();
            w.buildings.iter().map(|b| (json!([b.id]), id(city::building_realm(w, b)))).collect()
        }),
        ("isOutpostStorage", |s| {
            let w = s.w();
            w.buildings
                .iter()
                .map(|b| (json!([b.id]), json!(guard::is_outpost_storage(b))))
                .collect()
        }),
        ("cityResidents", |s| {
            let w = s.w();
            w.cities
                .iter()
                .map(|c| {
                    let rs = city::city_residents(w, &c.id);
                    (json!([c.id]), ids(rs.iter().map(|r| r.id.as_str())))
                })
                .collect()
        }),
        ("townHallOf", |s| {
            let w = s.w();
            w.cities
                .iter()
                .map(|c| (json!([c.id]), id(city::town_hall_of(w, c).map(|b| &b.id))))
                .collect()
        }),
        ("housingRoom", |s| {
            let w = s.w();
            w.cities
                .iter()
                .map(|c| (json!([c.id]), json!(city_area::housing_room(w, &c.id))))
                .collect()
        }),
        ("freeHousing", |s| {
            let w = s.w();
            w.cities
                .iter()
                .map(|c| (json!([c.id]), json!(city_area::free_housing(w, &c.id))))
                .collect()
        }),
        ("occupationTicksLeft", |s| {
            let w = s.w();
            w.cities
                .iter()
                .map(|c| (json!([c.id]), json!(city_area::occupation_ticks_left(w, c))))
                .collect()
        }),
        ("deliveryStorage", |s| {
            let w = s.w();
            w.cities
                .iter()
                .map(|c| {
                    let st = warehouse_trade::delivery_storage(w, &c.id);
                    (json!([c.id]), id(st.map(|b| &b.id)))
                })
                .collect()
        }),
        ("citiesToCarryAt", |s| {
            let w = s.w();
            let realms =
                w.cities.iter().filter_map(|c| c.realm_id.as_deref()).collect::<HashSet<_>>();
            let mut realms: Vec<_> = realms.into_iter().collect();
            realms.sort_unstable();
            realms
                .into_iter()
                .map(|realm| {
                    let cs = direct_offer::cities_to_carry_at(w, realm);
                    (json!([realm]), ids(cs.iter().map(|c| c.id.as_str())))
                })
                .collect()
        }),
        ("relocatingTo", |s| {
            let w = s.w();
            w.cities
                .iter()
                .map(|c| {
                    let rs = people::relocating_to(w, &c.id);
                    (json!([c.id]), ids(rs.iter().map(|r| r.id.as_str())))
                })
                .collect()
        }),
        ("relocateRoom", |s| {
            let w = s.w();
            let none = HashSet::new();
            w.cities
                .iter()
                .map(|c| (json!([c.id]), json!(people::relocate_room(w, &c.id, &none))))
                .collect()
        }),
        ("relocateProblem", |s| {
            let w = s.w();
            let mut out = Vec::new();
            for c in w.cities.iter().map(|c| Some(c.id.as_str())).chain([None, Some("nowhere")]) {
                for r in &w.residents {
                    let p = people::relocate_problem(w, &s.realm, &[r], c);
                    out.push((json!([[r.id], c]), json!(p)));
                }
                let all: Vec<_> =
                    w.residents.iter().filter(|r| r.owner.as_deref() == Some(&s.realm)).collect();
                let p = people::relocate_problem(w, &s.realm, &all, c);
                out.push((json!([all.iter().map(|r| &r.id).collect::<Vec<_>>(), c]), json!(p)));
            }
            out
        }),
        // Horses and people.
        ("breedersAt", |s| {
            let w = s.w();
            w.buildings
                .iter()
                .map(|b| {
                    let rs = breeding::breeders_at(&w.residents, b);
                    (json!([b.id]), ids(rs.iter().map(|r| r.id.as_str())))
                })
                .collect()
        }),
        ("riderOf", |s| {
            let w = s.w();
            w.horses
                .iter()
                .map(|h| (json!([h.id]), id(horses::rider_of(w, &h.id).map(|r| &r.id))))
                .collect()
        }),
        ("horseOfResident", |s| {
            let w = s.w();
            let mut out = Vec::new();
            for h in &w.horses {
                for r in &w.residents {
                    out.push((json!([h.id, r.id]), json!(riding::horse_of_resident(h, r))));
                }
            }
            out
        }),
        ("isDown", |s| {
            let w = s.w();
            let rs = w.residents.iter().map(|r| (json!(["resident", r.id]), r.down_until));
            let hs = w.horses.iter().map(|h| (json!(["horse", h.id]), h.down_until));
            rs.chain(hs).map(|(args, until)| (args, json!(residents::is_down(until)))).collect()
        }),
        ("bestWeapon", |s| {
            let w = s.w();
            w.residents.iter().map(|r| (json!([r.id]), id(equipped(r, Slot::Weapon)))).collect()
        }),
        ("isArmed", |s| {
            let w = s.w();
            w.residents.iter().map(|r| (json!([r.id]), json!(residents::is_armed(r)))).collect()
        }),
        ("fighterStrength", |s| {
            let w = s.w();
            w.residents
                .iter()
                .map(|r| (json!([r.id]), json!(persuasion::fighter_strength(r))))
                .collect()
        }),
        ("firstDayShown", |_| {
            let lines = ["claimHorses", "pickResident", "giveOrder", "openWiki"];
            let mut out = Vec::new();
            for n in 0..=lines.len() {
                for dismissed in [false, true] {
                    let done: Vec<String> = lines[..n].iter().map(|l| l.to_string()).collect();
                    let card = FirstDay { done: done.clone(), dismissed };
                    out.push((
                        json!([{ "done": done, "dismissed": dismissed }]),
                        json!(people::first_day_shown(&card)),
                    ));
                }
            }
            out
        }),
        ("richnessFactor", |_| {
            [Richness::Poor, Richness::Normal, Richness::Rich]
                .into_iter()
                .map(|r| (json!([r]), json!(r.factor())))
                .collect()
        }),
        ("wrap", |s| {
            [-1, 0, 5, s.size - 1, s.size, s.size + 7, -s.size - 3, 3 * s.size]
                .into_iter()
                .map(|v| (json!([v]), json!(wrap(v, s.size))))
                .collect()
        }),
        ("patchLeft", |_| {
            let mut out = Vec::new();
            for (left, at) in [(0.0, 0), (2.5, 100), (7.0, 5000)] {
                for tick in [0, 100, 1440, 5000, 20000, 40000, 100000] {
                    let p = Patch { x: 0, y: 0, left, at };
                    out.push((
                        json!([{ "left": left, "at": at }, tick]),
                        json!(csp_sim::gathering::patch_now(&p, tick)),
                    ));
                }
            }
            out
        }),
        ("horseFull", |s| {
            let w = s.w();
            w.horses
                .iter()
                .map(|h| (json!([h.id]), json!(csp_sim::horses::horse_full(h))))
                .collect()
        }),
        ("feedHorseProblem", |s| {
            let w = s.w();
            let mut out = Vec::new();
            for r in &w.residents {
                for h in &w.horses {
                    let p = csp_sim::reviving::feed_horse_problem(r, h, w.tick as f64, s.size);
                    out.push((json!([r.id, h.id]), json!(p)));
                }
            }
            out
        }),
        ("isClosed", |s| {
            let w = s.w();
            w.buildings
                .iter()
                .map(|b| (json!([b.id]), json!(csp_sim::walls::is_closed(b))))
                .collect()
        }),
        ("isAt", |s| {
            let w = s.w();
            let tiles = s.tiles();
            let mut out = Vec::new();
            for b in w.buildings.iter().take(60) {
                let placed = Placed { kind: kind_name(b.kind), x: b.x as i32, y: b.y as i32 };
                let on: Vec<_> = tiles.iter().filter(|&&t| is_at(t, placed, s.size)).collect();
                out.push((json!([b.id]), json!(on)));
            }
            out
        }),
        ("footprintTiles", |s| {
            let w = s.w();
            w.buildings
                .iter()
                .take(60)
                .map(|b| {
                    let placed = Placed { kind: kind_name(b.kind), x: b.x as i32, y: b.y as i32 };
                    (json!([b.id]), json!(footprint_tiles(placed, s.size)))
                })
                .collect()
        }),
        ("gatheredOn", |_| {
            (0u8..8)
                .map(|t| {
                    let goods: Vec<Good> = csp_sim::gathering::GATHERED_GOODS
                        .into_iter()
                        .filter(|g| {
                            csp_sim::gathering::gathered_on(*g).is_some_and(|(on, _)| on as u8 == t)
                        })
                        .collect();
                    (json!([t]), json!(goods))
                })
                .collect()
        }),
        ("isWater", |_| (0u8..8).map(|t| (json!([t]), json!(is_water(t)))).collect()),
        ("isPassableTerrain", |_| {
            (0u8..8).map(|t| (json!([t]), json!(is_passable_terrain(t)))).collect()
        }),
        ("wrapDelta", |s| {
            let pairs = [
                (0, 5),
                (5, 0),
                (1, s.size - 1),
                (s.size - 1, 1),
                (3, 3 + s.size / 2),
                (10, 10 + s.size / 2 + 1),
            ];
            pairs
                .into_iter()
                .map(|(a, b)| (json!([a, b]), json!(wrap_delta(a, b, s.size))))
                .collect()
        }),
        ("wrapDistance", |s| {
            let tiles = s.tiles();
            let pairs = tiles.iter().zip(tiles.iter().rev()).take(40);
            pairs.map(|(&a, &b)| (json!([a, b]), json!(wrap_distance(s.size, a, b)))).collect()
        }),
        ("tileIndex", |s| {
            let mut tiles = s.tiles();
            tiles.extend([(-1, -1), (s.size, 3), (2 * s.size + 1, -s.size)]);
            tiles
                .into_iter()
                .map(|(x, y)| (json!([x, y]), json!(tile_index(s.size, x, y))))
                .collect()
        }),
        // Offers.
        ("offersAt", |s| {
            let w = s.w();
            w.buildings
                .iter()
                .map(|b| {
                    (json!([b.id]), ids(offers::offers_at(w, &b.id).iter().map(|o| o.id.as_str())))
                })
                .collect()
        }),
        ("setAsideAt", |s| {
            let w = s.w();
            w.buildings
                .iter()
                .map(|b| (json!([b.id]), json!(offers::set_aside_at(w, &b.id))))
                .collect()
        }),
        ("freeStock", |s| {
            let w = s.w();
            w.buildings
                .iter()
                .map(|b| (json!([b.id]), json!(offers::free_stock(w, &b.id, b.stock.as_ref()))))
                .collect()
        }),
        ("timesToPost", |s| {
            let w = s.w();
            let mut out = Vec::new();
            for b in w.buildings.iter().filter(|b| b.stock.is_some()) {
                for (good, units, times) in [(Good::Food, 4.0, 10.0), (Good::Wood, 1.0, 3.0)] {
                    let n = offers::times_to_post(w, b, good, units, times);
                    out.push((json!([b.id, good, units, times]), json!(n)));
                }
            }
            out
        }),
        ("offerOpenTo", |s| {
            let w = s.w();
            let mut out = Vec::new();
            for o in &w.offers {
                for side in
                    w.realms.iter().map(|r| r.id.as_str()).chain([s.realm.as_str(), "realm134"])
                {
                    out.push((json!([o.id, side]), json!(offers::offer_open_to(o, side))));
                }
            }
            out
        }),
        ("wantsNothing", |s| {
            let w = s.w();
            w.offers.iter().map(|o| (json!([o.id]), json!(offers::wants_nothing(o)))).collect()
        }),
        // Vessels.
        ("besideVessel", |s| {
            let w = s.w();
            let tiles = s.tiles();
            w.vessels
                .iter()
                .map(|v| {
                    let on: Vec<_> = tiles
                        .iter()
                        .filter(|&&(x, y)| vessels::beside_vessel(w, v, x.into(), y.into()))
                        .collect();
                    (json!([v.id]), json!(on))
                })
                .collect()
        }),
        ("crewShort", |s| {
            let w = s.w();
            w.vessels.iter().map(|v| (json!([v.id]), json!(vessels::crew_short(w, v)))).collect()
        }),
        ("vesselCapacity", |s| {
            let w = s.w();
            w.vessels.iter().map(|v| (json!([v.id]), json!(vessels::vessel_capacity(v)))).collect()
        }),
        ("vesselName", |s| {
            let w = s.w();
            w.vessels.iter().map(|v| (json!([v.id]), json!(vessels::vessel_name(v)))).collect()
        }),
        ("vesselRoom", |s| {
            let w = s.w();
            w.vessels.iter().map(|v| (json!([v.id]), json!(vessels::vessel_room(w, v)))).collect()
        }),
        ("vesselOfResident", |s| {
            let w = s.w();
            let mut out = Vec::new();
            for v in &w.vessels {
                for r in &w.residents {
                    out.push((json!([v.id, r.id]), json!(vessels::vessel_of_resident(v, r))));
                }
            }
            out
        }),
        // Warehouses, trade and transfers.
        ("warehouseKeeps", |s| {
            let w = s.w();
            w.buildings
                .iter()
                .map(|b| (json!([b.id]), json!(warehouse::warehouse_keeps(w, b))))
                .collect()
        }),
        ("stockFloor", |s| {
            let w = s.w();
            w.buildings
                .iter()
                .map(|b| (json!([b.id]), json!(warehouse::stock_floor(w, b))))
                .collect()
        }),
        ("tradeCoinWarehouse", |s| {
            let w = s.w();
            w.buildings
                .iter()
                .map(|b| (json!([b.id]), id(warehouse::trade_coin_warehouse(w, b).map(|c| &c.id))))
                .collect()
        }),
        ("transferWarehouses", |s| {
            let w = s.w();
            vec![(json!([]), ids(transfer::transfer_warehouses(w).iter().map(|b| b.id.as_str())))]
        }),
        ("nearestWarehouse", |s| {
            let w = s.w();
            w.buildings
                .iter()
                .filter(|b| b.kind == BuildingKind::Storage)
                .map(|b| {
                    let near = transfer::nearest_warehouse(w, (b.x, b.y), s.size);
                    (json!([b.id]), id(near.map(|n| &n.id)))
                })
                .collect()
        }),
        ("quoteTrade", |s| {
            let w = s.w();
            let held = held();
            let mut out = Vec::new();
            for b in trading(w) {
                for side in [TradeSide::Buy, TradeSide::Sell] {
                    for (good, wanted, owed) in
                        [(Good::Food, 5.0, 0.0), (Good::Wood, 40.0, 2.0), (Good::Iron, 3.0, 0.0)]
                    {
                        let holder = TradeHolder { stock: &held, room: 60.0 };
                        let q = warehouse_trade::quote_trade(
                            w,
                            b,
                            holder,
                            side,
                            good,
                            wanted,
                            owed,
                            &[],
                        );
                        out.push((
                            json!([b.id, side, good, wanted, owed]),
                            trade_quote(q.units, q.coins, q.limit),
                        ));
                    }
                }
            }
            out
        }),
        ("quoteSwap", |s| {
            let w = s.w();
            let held = held();
            let mut out = Vec::new();
            for b in trading(w) {
                for (give, want, wanted, owed) in
                    [(Good::Food, Good::Wood, 5.0, 0.0), (Good::Wood, Good::Food, 30.0, 1.0)]
                {
                    let holder = TradeHolder { stock: &held, room: 60.0 };
                    let q = trade_quotes::quote_swap(w, b, holder, give, want, wanted, owed);
                    out.push((json!([b.id, give, want, wanted, owed]), swap_quote(&q)));
                }
            }
            out
        }),
        ("quoteDelivery", |s| {
            let w = s.w();
            let payer = held();
            let mut out = Vec::new();
            for b in trading(w) {
                for (good, wanted, tiles, owed) in
                    [(Good::Food, 8.0, 40.0, 0.0), (Good::Wood, 50.0, 200.0, 3.0)]
                {
                    let q =
                        warehouse_trade::quote_delivery(w, b, &payer, good, wanted, tiles, owed);
                    out.push((
                        json!([b.id, good, wanted, tiles, owed]),
                        json!({ "units": q.units, "coins": q.coins, "fee": q.fee }),
                    ));
                }
            }
            out
        }),
        ("quotePickUp", |s| {
            let w = s.w();
            let mut out = Vec::new();
            for b in trading(w) {
                for (good, wanted, held, tiles, budget) in
                    [(Good::Food, 8.0, 6.0, 40.0, 100.0), (Good::Wood, 50.0, 50.0, 300.0, 20.0)]
                {
                    let q = warehouse_trade::quote_pick_up(w, b, good, wanted, held, tiles, budget);
                    out.push((
                        json!([b.id, good, wanted, held, tiles, budget]),
                        json!({ "units": q.units, "coins": q.coins, "fee": q.fee }),
                    ));
                }
            }
            out
        }),
    ]
}

/// Goods a trader holds, for the quotes.
fn held() -> Stock {
    [(Good::Food, 20.0), (Good::Coins, 50.0), (Good::Wood, 10.0)].into_iter().collect()
}

/// The warehouses and storages, where the quotes are asked.
fn trading(w: &WorldState) -> impl Iterator<Item = &csp_shared::world::Building> {
    w.buildings.iter().filter(|b| matches!(b.kind, BuildingKind::Warehouse | BuildingKind::Storage))
}

fn written() -> Value {
    let sent = sent();
    let worlds: Vec<Value> = sent
        .iter()
        .map(|s| {
            json!({ "name": s.name, "size": s.size, "tick": s.w().tick, "realm": s.realm,
                    "entities": s.seen })
        })
        .collect();
    let mut cases = serde_json::Map::new();
    for (name, twin) in twins() {
        let per_world: Vec<Value> = sent
            .iter()
            .map(|s| {
                let asked = twin(s);
                json!(asked
                    .into_iter()
                    .map(|(args, answer)| json!([args, answer]))
                    .collect::<Vec<_>>())
            })
            .collect();
        cases.insert(name.to_string(), json!(per_world));
    }
    json!({ "worlds": worlds, "twins": cases })
}

#[test]
fn the_client_twins_file_holds_what_the_rust_originals_answer() {
    let want = written();
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(OUT);
    if std::env::var_os("CSP_WRITE_TWINS").is_some() {
        std::fs::write(&path, serde_json::to_string(&want).unwrap() + "\n").unwrap();
    }
    let have: Value = std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null);
    assert!(
        normalised(&have) == normalised(&want),
        "{OUT} is not what the Rust originals answer: write it again with \
         `CSP_WRITE_TWINS=1 cargo nextest run -p csp-sim client_twins`, then run \
         `client-twins.test.ts` in the client"
    );
    for (name, cases) in want["twins"].as_object().unwrap() {
        let asked: usize =
            cases.as_array().unwrap().iter().map(|w| w.as_array().unwrap().len()).sum();
        assert!(asked > 0, "{name} is asked nothing on either world");
    }
}

/// What stops a trade short, as the client names it.
fn limit_name(limit: warehouse_trade::TradeLimit) -> &'static str {
    use warehouse_trade::TradeLimit::*;
    match limit {
        Coins => "coins",
        Held => "held",
        Room => "room",
        Stock => "stock",
        TheirCoins => "theirCoins",
        TheirRoom => "theirRoom",
        Unwanted => "unwanted",
        Refused => "refused",
    }
}

/// A trade quote as the client has it: its limit only when something cut it short.
fn trade_quote(units: f64, coins: f64, limit: Option<warehouse_trade::TradeLimit>) -> Value {
    let mut out = json!({ "units": units, "coins": coins });
    if let Some(limit) = limit {
        out["limit"] = json!(limit_name(limit));
    }
    out
}

fn swap_quote(q: &trade_quotes::SwapQuote) -> Value {
    let mut out = json!({ "units": q.units, "gives": q.gives, "coins": q.coins, "bought": q.bought,
                          "sold": q.sold });
    if let Some(limit) = q.limit {
        out["limit"] = json!(limit_name(limit));
    }
    out
}

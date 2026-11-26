//! The client's world mirror answers as the world does (T122.4, ADR 0045): for the fixture worlds
//! and each realm in them, a mirror built from what the server sends that realm (`sight.rs`, with
//! every tile in sight) gives each rule the client has a twin of the answer the full world gives.
//! A rule that reads something no Player is sent may answer otherwise: it is named in `DIFFERS`
//! with the answer the mirror gives, as `docs/wasm-rules.md` lists it.

mod common;

use std::collections::{BTreeMap, HashSet};
use std::fmt::Debug;

use common::load_world;
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{
    Alliance, Building, BuildingKind, CarriedFeeBy, Demand, Good, Resident, ResourceNode, Stock,
    TradeSide, TrainingSubject, WallMaterial, WorldState,
};
use csp_sim::mirror::SightMirror;
use csp_sim::queries::building::{BuildLine, TerrainLookup};
use csp_sim::queries::demand::DemandHandOver;
use csp_sim::queries::direct_offer::{CarriedRequest, OfferGoods};
use csp_sim::queries::horses::HorseOwner;
use csp_sim::queries::standing::TRADE_ORG;
use csp_sim::queries::trade_quotes::OfferTerms;
use csp_sim::queries::warehouse_trade::TradeHolder;
use csp_sim::queries::{
    alliance, alliance_rules, army, breeding, building, carriages, city, city_area, command,
    contract, demand, direct_offer, driving, estimates, goods, guard, horse_market, horses, leader,
    npc_trade, offers, people, persuasion, riding, standing, trade_org, trade_quotes, trader_trade,
    transfer, vessels, walls, warehouse, warehouse_trade,
};
use csp_sim::sight::entities_revealed;
use csp_sim::world_index::WorldIndex;
use csp_sim::{caravans, directive, order_sender, script_deps, walls as wall_rules};
use serde_json::{Map, Value};

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
    /// Each realm and its Leader.
    realms: Vec<(String, String)>,
    /// Every organization: the realms, the cities and the Trade Organization.
    orgs: Vec<String>,
    /// The tiles on and next to each resident, for the rules that cost more per tile.
    near: Vec<(i32, i32)>,
    /// The fixtures hold no terrain: an open map of Plains of their size.
    terrain: TerrainMap,
    /// What the rules take as a whole and the mirror doesn't hold, from the full world.
    alliances: Vec<Alliance>,
    demands: Vec<Demand>,
    nodes: Vec<ResourceNode>,
    offer_ids: Vec<String>,
    directive_ids: Vec<String>,
}

fn ids<'w>(xs: impl Iterator<Item = Option<&'w str>>) -> Vec<String> {
    xs.map(|x| x.unwrap_or("-").to_string()).collect()
}

/// Each rule over every tile or id it takes.
fn rules() -> Vec<(&'static str, Rule)> {
    let mut rules: Vec<(&str, Rule)> = vec![
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
    ];
    rules.extend(more_rules());
    rules.extend(trade_rules());
    rules
}

/// The rules of the other twins (T1638), by the TypeScript file they are in.
fn more_rules() -> Vec<(&'static str, Rule)> {
    vec![
        // alliance.ts
        ("isAllianceCity", |w, _, a| {
            a.city_ids.iter().map(|c| alliance_rules::is_alliance_city(w, c).to_string()).collect()
        }),
        ("knowsRecentCrime", |w, _, a| {
            let mut out = Vec::new();
            for c in &a.city_ids {
                for o in &a.orgs {
                    out.push(alliance_rules::knows_recent_crime(w, c, o).to_string());
                }
            }
            out
        }),
        ("npcCityAccepts", |w, _, a| {
            let mut out = Vec::new();
            for c in &a.city_ids {
                for x in &a.alliances {
                    out.push(alliance_rules::npc_city_accepts(w, c, x).to_string());
                }
            }
            out
        }),
        ("npcCityWantsOut", |w, _, a| {
            let mut out = Vec::new();
            for c in &a.city_ids {
                for x in &a.alliances {
                    out.push(alliance_rules::npc_city_wants_out(w, c, x).to_string());
                }
            }
            out
        }),
        ("handedOverTo", |w, _, a| {
            ids(a
                .resident_ids
                .iter()
                .chain(&a.carriage_ids)
                .map(|id| alliance::handed_over_to(w, id).map(|x| x.id.as_str())))
        }),
        ("armyPartOf", |w, _, a| {
            a.resident_ids
                .iter()
                .chain(&a.carriage_ids)
                .map(|id| d(alliance_rules::army_part_of(w, id)))
                .collect()
        }),
        ("commanderOf", |w, _, _| {
            w.residents
                .iter()
                .map(|r| d(alliance::commander_of(w, &r.id, r.owner.as_deref())))
                .collect()
        }),
        ("carriageCommanderOf", |w, _, _| {
            w.carriages.iter().map(|k| d(alliance::carriage_commander_of(w, k))).collect()
        }),
        ("commands", |w, _, a| {
            let mut out = Vec::new();
            for realm in &a.realm_ids {
                out.push(order_sender::commands(w, realm, None).to_string());
                for r in &w.residents {
                    out.push(order_sender::commands(w, realm, Some(r)).to_string());
                }
            }
            out
        }),
        ("commandsCarriage", |w, _, a| {
            let mut out = Vec::new();
            for realm in &a.realm_ids {
                for k in &w.carriages {
                    out.push(command::commands_carriage(w, realm, Some(k)).to_string());
                }
            }
            out
        }),
        ("stealsCarriage", |w, _, a| {
            let mut out = Vec::new();
            for realm in &a.realm_ids {
                for k in &w.carriages {
                    out.push(command::steals_carriage(w, realm, k).to_string());
                }
            }
            out
        }),
        ("allianceOf", |w, _, a| {
            ids(a.realm_ids.iter().map(|r| alliance::alliance_of(w, r).map(|x| x.id.as_str())))
        }),
        ("alliedRealms", |w, _, a| {
            a.realm_ids.iter().map(|r| d(alliance::allied_realms(w, r))).collect()
        }),
        ("allied", |w, _, a| {
            let mut out = Vec::new();
            for x in &a.realm_ids {
                for y in &a.realm_ids {
                    out.push(alliance::allied(w, x, y).to_string());
                }
            }
            out
        }),
        ("sharingSight", |w, _, a| {
            a.realm_ids.iter().map(|r| d(alliance::sharing_sight(w, r))).collect()
        }),
        ("realmName", |w, _, a| a.realm_ids.iter().map(|r| alliance::realm_name(w, r)).collect()),
        ("realmsStandingTogether", |w, _, _| vec![d(alliance_rules::realms_standing_together(w))]),
        // army.ts
        ("armySpot", |w, s, _| {
            w.armies
                .iter()
                .map(|x| {
                    let from = x
                        .member_ids
                        .first()
                        .and_then(|m| w.residents.iter().find(|r| &r.id == m))
                        .map_or((0.0, 0.0), |r| (r.x, r.y));
                    d(army::army_spot(w, &x.id, from, s))
                })
                .collect()
        }),
        ("spareFood", |w, _, _| {
            w.carriages.iter().map(|k| army::spare_food(w, k).to_string()).collect()
        }),
        ("driversFood", |w, _, _| {
            w.residents.iter().map(|r| d(army::drivers_food(w, r))).collect()
        }),
        // building.ts
        ("constructionAt", |w, _, _| {
            w.buildings
                .iter()
                .map(|b| bid(building::construction_at(w, b.x as i32, b.y as i32, b.kind)))
                .collect()
        }),
        ("carriageCanGoTo", |w, _, a| {
            a.tiles
                .iter()
                .map(|&(x, y)| building::carriage_can_go_to(w, &a.terrain, x, y).to_string())
                .collect()
        }),
        ("carriageCanGoTo (driving)", |w, _, a| {
            a.tiles
                .iter()
                .map(|&(x, y)| driving::carriage_can_go_to(w, &a.terrain, x, y).to_string())
                .collect()
        }),
        ("buildProblem", |w, _, a| {
            let t: &dyn TerrainLookup = &a.terrain;
            let mut out: Vec<String> = w
                .buildings
                .iter()
                .map(|b| d(building::build_problem(w, b.x as i32, b.y as i32, b.kind, Some(t))))
                .collect();
            for &(x, y) in &a.near {
                for &kind in KINDS_TO_BUILD {
                    out.push(d(building::build_problem(w, x, y, kind, Some(t))));
                }
            }
            out
        }),
        ("buildAtProblem", |w, _, a| {
            let mut out = Vec::new();
            for r in &w.residents {
                for (dx, dy) in [(0, 0), (2, 1)] {
                    for &kind in KINDS_TO_BUILD {
                        let at = (r.x as i32 + dx, r.y as i32 + dy);
                        out.push(d(building::build_at_problem(
                            w,
                            r,
                            Some(kind),
                            at,
                            Some(&a.terrain),
                        )));
                    }
                }
            }
            out
        }),
        ("nodeCorner", |w, _, a| {
            a.nodes.iter().map(|n| d(building::node_corner(w, &a.terrain, n))).collect()
        }),
        ("workplaceGood", |w, _, _| {
            let mut out = Vec::new();
            for b in &w.buildings {
                out.push(d(building::workplace_good(w, b, None)));
                out.push(d(building::workplace_good(w, b, Some(Good::Iron))));
            }
            out
        }),
        ("hasInput", |w, _, _| {
            let mut out = Vec::new();
            for b in &w.buildings {
                for recipe in building::recipes_of(b.kind) {
                    out.push(building::has_input(w, b, recipe).to_string());
                }
            }
            out
        }),
        ("inputToFetch", |w, _, _| {
            let mut out = Vec::new();
            for b in &w.buildings {
                for recipe in building::recipes_of(b.kind) {
                    for r in w.residents.iter().filter(|r| r.city_id == b.city_id).take(3) {
                        out.push(d(building::input_to_fetch(w, b, recipe, r)));
                    }
                }
            }
            out
        }),
        ("teachProblem", |w, _, _| {
            let mut out = Vec::new();
            for r in &w.residents {
                for subject in
                    [None, Some(TrainingSubject::Strength), Some(TrainingSubject::Mining)]
                {
                    out.push(d(building::teach_problem(w, r, subject)));
                }
            }
            out
        }),
        ("trainProblem", |w, _, _| {
            w.residents.iter().map(|r| d(building::train_problem(w, r))).collect()
        }),
        ("workProblem", |w, _, _| {
            let mut out = Vec::new();
            for r in &w.residents {
                out.push(d(building::work_problem(w, r, None)));
                out.push(d(building::work_problem(w, r, Some(Good::Food))));
            }
            out
        }),
        ("strandsOnMountain", |w, _, a| {
            w.buildings
                .iter()
                .map(|b| building::strands_on_mountain(w, b, &a.terrain).to_string())
                .collect()
        }),
        ("tearDownProblem", |w, _, a| {
            w.buildings
                .iter()
                .map(|b| {
                    d(building::tear_down_problem(
                        w,
                        b.x as i32,
                        b.y as i32,
                        &b.id,
                        Some(&a.terrain),
                    ))
                })
                .collect()
        }),
        ("lineTile", |w, _, a| {
            let t: &dyn TerrainLookup = &a.terrain;
            let mut out = Vec::new();
            for &(x, y) in &a.near {
                for (kind, material) in LINES {
                    out.push(d(building::line_tile(w, kind, material, x, y, Some(t))));
                }
            }
            out
        }),
        ("lineToBuild", |w, _, a| {
            let mut out = Vec::new();
            for r in &w.residents {
                for (kind, material) in LINES {
                    let from = (r.x as i32, r.y as i32);
                    let line =
                        BuildLine { building: kind, from, to: (from.0 + 6, from.1), material };
                    out.push(d(building::line_to_build(w, &line, Some(&a.terrain))));
                }
            }
            out
        }),
        ("shipSiteAt", |w, _, a| {
            a.tiles.iter().map(|&(x, y)| bid(building::ship_site_at(w, x, y))).collect()
        }),
        ("buildingPile", |w, _, _| {
            ids(w.buildings.iter().map(|b| building::building_pile(w, b).map(|p| p.id.as_str())))
        }),
        // carriages.ts
        ("convoysOf", |w, _, _| vec![d(caravans::convoys_of(w))]),
        ("convoyOf", |w, _, _| {
            w.residents.iter().map(|r| d(caravans::convoy_of(w, &r.id))).collect()
        }),
        ("caravanEscortsWanted", |w, _, a| {
            a.city_ids.iter().map(|c| caravans::caravan_escorts_wanted(w, c).to_string()).collect()
        }),
        ("horseLiesDown", |w, _, _| {
            (0..w.carriages.len()).map(|i| caravans::horse_lies_down(w, i).to_string()).collect()
        }),
        ("driveProblem", |w, _, _| {
            let mut out = Vec::new();
            for r in &w.residents {
                for k in &w.carriages {
                    out.push(d(driving::drive_problem(w, r, k)));
                }
            }
            out
        }),
        ("takeProblem", |w, _, a| {
            let mut out = Vec::new();
            for realm in &a.realm_ids {
                for r in &w.residents {
                    for k in &w.carriages {
                        let at = (k.x, k.y);
                        let p = driving::take_problem(
                            w,
                            r,
                            at,
                            &k.realm_id,
                            &k.city_id,
                            realm,
                            "carriage",
                        );
                        out.push(d(p));
                    }
                }
            }
            out
        }),
        ("horseToSteal", |w, _, a| {
            let mut out = Vec::new();
            for realm in &a.realm_ids {
                for r in &w.residents {
                    for k in &w.carriages {
                        out.push(d(driving::horse_to_steal(w, r, k, realm, None).map(|h| &h.id)));
                    }
                }
            }
            out
        }),
        ("hitchOffProblem", |w, _, a| {
            let mut out = Vec::new();
            for realm in &a.realm_ids {
                for r in &w.residents {
                    for k in &w.carriages {
                        out.push(d(driving::hitch_off_problem(w, r, k, realm, None)));
                    }
                }
            }
            out
        }),
        ("driveOffProblem", |w, s, a| {
            let mut out = Vec::new();
            for realm in &a.realm_ids {
                for r in &w.residents {
                    for k in &w.carriages {
                        out.push(d(driving::drive_off_problem(w, r, k, realm, s)));
                    }
                }
            }
            out
        }),
        ("hitchProblem", |w, _, a| {
            let mut out = Vec::new();
            for r in &w.residents {
                for k in &w.carriages {
                    out.push(d(driving::hitch_problem(w, r, Some(k), None)));
                    for h in &a.horse_ids {
                        out.push(d(driving::hitch_problem(w, r, Some(k), Some(h))));
                    }
                }
            }
            out
        }),
        ("boardProblem", |w, _, _| {
            let mut out = Vec::new();
            for r in &w.residents {
                out.push(d(driving::board_problem(w, r, None)));
                for k in &w.carriages {
                    out.push(d(driving::board_problem(w, r, Some(k))));
                }
            }
            out
        }),
        ("carriageRoom", |w, _, _| {
            w.carriages.iter().map(|k| goods::carriage_room(w, k).to_string()).collect()
        }),
        ("unitsThatFitCarriage", |w, _, _| {
            let mut out = Vec::new();
            for k in &w.carriages {
                for &g in Good::ALL {
                    out.push(goods::units_that_fit_carriage(w, k, g).to_string());
                }
            }
            out
        }),
        ("haulStopSpot", |w, _, a| {
            a.tiles
                .iter()
                .map(|&(x, y)| d(goods::haul_stop_spot(w, f64::from(x), f64::from(y))))
                .collect()
        }),
        // city.ts
        ("cityMembership", |w, s, _| {
            vec![d(city_area::city_membership(w, s).into_iter().collect::<BTreeMap<_, _>>())]
        }),
        ("nearCityArea", |w, s, a| {
            let mut out = Vec::new();
            for c in &a.city_ids {
                for &(x, y) in &a.near {
                    let near = city_area::near_city_area(w, c, f64::from(x), f64::from(y), 5.0, s);
                    out.push(near.to_string());
                }
            }
            out
        }),
        ("citiesAt", |w, s, a| {
            a.tiles
                .iter()
                .map(|&(x, y)| {
                    let at = city_area::cities_at(w, f64::from(x), f64::from(y), s);
                    d(at.into_iter().map(|i| &w.cities[i].id).collect::<Vec<_>>())
                })
                .collect()
        }),
        ("defendsCity", |w, s, _| {
            let mut out = Vec::new();
            for c in &w.cities {
                for r in &w.residents {
                    out.push(city_area::defends_city(w, c, r, s).to_string());
                }
            }
            out
        }),
        ("occupiersOf", |w, s, _| {
            w.cities
                .iter()
                .map(|c| {
                    let of = city_area::occupiers_of(w, c, s);
                    d(of.into_iter().map(|i| &w.residents[i].id).collect::<Vec<_>>())
                })
                .collect()
        }),
        ("standsOccupying", |w, s, _| {
            let mut out = Vec::new();
            for c in &w.cities {
                for r in &w.residents {
                    out.push(city_area::stands_occupying(w, c, r, s).to_string());
                }
            }
            out
        }),
        ("cityTakers", |w, _, _| {
            w.cities.iter().map(|c| d(sorted(city_area::city_takers(w, c)))).collect()
        }),
        ("occupationTicksLeft", |w, _, _| {
            w.cities.iter().map(|c| d(city_area::occupation_ticks_left(w, c))).collect()
        }),
        ("occupierOf", |w, s, _| {
            w.cities.iter().map(|c| d(city_area::occupier_of(w, c, s))).collect()
        }),
        ("outpostStorageGuarded", |w, s, _| {
            w.buildings
                .iter()
                .map(|b| guard::outpost_storage_guarded(w, b, s).to_string())
                .collect()
        }),
        ("cityFoodUse", |w, _, _| {
            w.cities.iter().map(|c| city::city_food_use(w, c, 1.0).to_string()).collect()
        }),
        ("surplusFoodLine", |w, _, _| {
            w.cities.iter().map(|c| city::surplus_food_line(w, c).to_string()).collect()
        }),
        ("hasFoodSurplus", |w, _, _| {
            w.cities.iter().map(|c| city::has_food_surplus(w, c).to_string()).collect()
        }),
        ("npcCityRefuses", |w, _, a| {
            let mut out = Vec::new();
            for c in &w.cities {
                for o in &a.orgs {
                    out.push(city::npc_city_refuses(w, c, o).to_string());
                }
            }
            out
        }),
        ("sellsTo", |w, _, a| {
            let mut out = Vec::new();
            for c in &w.cities {
                for realm in &a.realm_ids {
                    out.push(city::sells_to(w, c, realm).to_string());
                }
            }
            out
        }),
        ("cityPrice", |w, _, a| {
            let mut out = Vec::new();
            for c in &w.cities {
                out.push(city::city_price(w, c, None).to_string());
                for realm in &a.realm_ids {
                    out.push(city::city_price(w, c, Some(realm)).to_string());
                }
            }
            out
        }),
        ("buyersAtTownHall", |w, _, a| {
            let mut out = Vec::new();
            for c in &w.cities {
                for realm in &a.realm_ids {
                    let at = trade_quotes::buyers_at_town_hall(w, c, realm);
                    out.push(d(at.into_iter().map(|i| &w.residents[i].id).collect::<Vec<_>>()));
                }
            }
            out
        }),
        ("coinsAtTownHall", |w, _, a| {
            let mut out = Vec::new();
            for c in &w.cities {
                for realm in &a.realm_ids {
                    out.push(trade_quotes::coins_at_town_hall(w, c, realm).to_string());
                }
            }
            out
        }),
        ("buyProblem", |w, _, a| {
            let mut out = Vec::new();
            for realm in &a.realm_ids {
                for r in &w.residents {
                    for c in &a.city_ids {
                        let city = Value::from(c.as_str());
                        out.push(d(trade_quotes::buy_problem(w, realm, r, Some(&city))));
                    }
                }
            }
            out
        }),
        // contract.ts
        ("contractOf", |w, _, a| {
            a.resident_ids.iter().map(|r| d(alliance::contract_of(w, r))).collect()
        }),
        ("contractsFor", |w, _, a| {
            a.realm_ids.iter().map(|r| d(contract::contracts_for(w, r))).collect()
        }),
        // demand.ts
        ("realmsKnownTo", |w, _, a| {
            a.realm_ids
                .iter()
                .map(|r| d(demand::realms_known_to(w, r, a.realm_ids.iter().map(String::as_str))))
                .collect()
        }),
        ("answeredByGame", |w, _, a| {
            a.orgs.iter().map(|o| d(demand::answered_by_game(w, o))).collect()
        }),
        ("npcOrgsKnownTo", |w, _, a| {
            a.realm_ids
                .iter()
                .map(|r| d(demand::npc_orgs_known_to(w, r, a.orgs.iter().map(String::as_str))))
                .collect()
        }),
        ("yieldsToDemand", |w, s, a| {
            let mut out = Vec::new();
            for c in &w.cities {
                for realm in &a.realm_ids {
                    out.push(demand::yields_to_demand(w, c, realm, s).to_string());
                }
            }
            out
        }),
        ("demandYieldNeeded", |w, _, _| {
            w.cities.iter().map(|c| demand::demand_yield_needed(w, c).to_string()).collect()
        }),
        ("goodsHandedOver", |w, _, a| {
            let goods: Stock = [(Good::Food, 10.0), (Good::Wood, 5.0)].into_iter().collect();
            let mut out = Vec::new();
            for realm in &a.realm_ids {
                for b in of_kind(w, STORAGES, 12) {
                    let how = DemandHandOver::SetAside { storage_id: b.id.clone() };
                    out.push(d(demand::goods_handed_over(w, realm, &goods, &how)));
                }
                for from in &a.city_ids {
                    for to in &a.city_ids {
                        let how = DemandHandOver::Transfer {
                            from_city_id: from.clone(),
                            to_city_id: to.clone(),
                        };
                        out.push(d(demand::goods_handed_over(w, realm, &goods, &how)));
                    }
                }
            }
            out
        }),
        ("demandHandOverProblem", |w, _, a| {
            a.demands
                .iter()
                .map(|x| d(demand::demand_hand_over_problem(w, &x.to_id, x, None)))
                .collect()
        }),
        ("demandWavering", |w, _, a| {
            a.demands.iter().map(|x| d(demand::demand_wavering(w, x))).collect()
        }),
        ("demandsFor", |w, _, a| {
            a.realm_ids.iter().map(|r| d(script_deps::demands_for(w, r))).collect()
        }),
        // direct-offer.ts
        ("realmsToOfferTo", |w, _, a| {
            a.realm_ids
                .iter()
                .map(|r| {
                    d(direct_offer::realms_to_offer_to(
                        w,
                        r,
                        a.realm_ids.iter().map(String::as_str),
                    ))
                })
                .collect()
        }),
        ("directOfferProblem", |w, _, a| {
            let mut out = Vec::new();
            for realm in &a.realm_ids {
                for b in of_kind(w, STORAGES, 6) {
                    let terms = offer_terms(&b.id);
                    for to in &a.realm_ids {
                        out.push(d(direct_offer::direct_offer_problem(w, realm, Some(to), &terms)));
                    }
                }
            }
            out
        }),
        ("carriedOfferFees", |w, s, a| {
            let goods = OfferGoods {
                gives: Good::Food,
                gives_units: 10.0,
                wants: Good::Wood,
                wants_units: 10.0,
                times: 2.0,
            };
            let mut out = Vec::new();
            for from in &a.city_ids {
                for to in &a.city_ids {
                    for by in [CarriedFeeBy::Sender, CarriedFeeBy::Split] {
                        out.push(d(direct_offer::carried_offer_fees(w, s, from, to, by, goods)));
                    }
                }
            }
            out
        }),
        ("carriedOfferProblem", |w, _, a| {
            let goods = offer_terms("-");
            let split = Value::from("split");
            let mut out = Vec::new();
            for realm in &a.realm_ids {
                for to in &a.realm_ids {
                    for from in &a.city_ids {
                        for to_city in &a.city_ids {
                            let (f, t) =
                                (Value::from(from.as_str()), Value::from(to_city.as_str()));
                            let carried = CarriedRequest {
                                from_city_id: Some(&f),
                                to_city_id: Some(&t),
                                fee_by: Some(&split),
                            };
                            let p = direct_offer::carried_offer_problem(
                                w,
                                realm,
                                Some(to),
                                &carried,
                                &goods,
                            );
                            out.push(d(p));
                        }
                    }
                }
            }
            out
        }),
        ("acceptCarriedProblem", |w, _, a| {
            let mut out = Vec::new();
            for realm in &a.realm_ids {
                for o in &a.offer_ids {
                    out.push(d(direct_offer::accept_carried_problem(w, realm, Some(o))));
                }
            }
            out
        }),
        ("declineOfferProblem", |w, _, a| {
            let mut out = Vec::new();
            for realm in &a.realm_ids {
                for o in &a.offer_ids {
                    out.push(d(direct_offer::decline_offer_problem(w, realm, Some(o))));
                }
            }
            out
        }),
        // directive.ts
        ("directiveTargets", |w, _, a| {
            let mut out = Vec::new();
            for o in &a.orgs {
                for with in [false, true] {
                    out.push(d(directive::directive_targets(w, o, with)));
                }
            }
            out
        }),
        ("directiveAgainst", |w, _, a| {
            ids(a.orgs.iter().map(|o| directive::directive_against(w, o).map(|x| x.id.as_str())))
        }),
        ("directiveSoldiers", |w, _, a| {
            let mut out = Vec::new();
            for o in &a.orgs {
                for with in [false, true] {
                    out.push(d(names(directive::directive_soldiers(w, o, with))));
                }
            }
            out
        }),
        ("directivesFor", |w, _, _| vec![d(directive::directives_for(w, |s| s.to_string()))]),
        // estimates.ts
        ("arrivalTicks", |w, s, _| {
            let ground = |_: f64, _: f64| Terrain::Plains as u8;
            w.residents.iter().map(|r| d(estimates::arrival_ticks(w, s, &ground, r))).collect()
        }),
        // goods.ts
        ("siteAt", |w, _, _| {
            w.buildings.iter().map(|b| bid(goods::site_at(w, b.x, b.y, &b.id))).collect()
        }),
        ("goodsAtSpot", |w, _, a| {
            a.tiles
                .iter()
                .map(|&(x, y)| {
                    let (x, y) = (f64::from(x), f64::from(y));
                    let spot = goods::haul_stop_spot(w, x, y);
                    d(goods::goods_at_spot(w, x, y, &spot))
                })
                .collect()
        }),
        ("downOn", |w, _, _| {
            w.residents
                .iter()
                .map(|r| d(goods::down_on(w, r.x, r.y, &r.id).map(|x| &x.id)))
                .collect()
        }),
    ]
}

/// The rules of the other twins (T1638), horse market to warehouse.
fn trade_rules() -> Vec<(&'static str, Rule)> {
    vec![
        // horse-market.ts
        ("npcHorsesOf", |w, _, _| {
            w.cities
                .iter()
                .map(|c| {
                    d(horse_market::npc_horses_of(w, c).iter().map(|h| &h.id).collect::<Vec<_>>())
                })
                .collect()
        }),
        ("npcHorsePrice", |w, _, _| {
            let mut out = Vec::new();
            for c in &w.cities {
                for h in &w.horses {
                    out.push(horse_market::npc_horse_price(w, c, h, None).to_string());
                }
            }
            out
        }),
        ("npcHorseBuyPrice", |w, _, _| {
            let mut out = Vec::new();
            for c in &w.cities {
                for h in &w.horses {
                    out.push(horse_market::npc_horse_buy_price(w, c, h, None).to_string());
                }
            }
            out
        }),
        ("npcHorseSaleProblem", |w, _, a| {
            let mut out = Vec::new();
            for c in &w.cities {
                for h in &w.horses {
                    for realm in &a.realm_ids {
                        out.push(d(horse_market::npc_horse_sale_problem(w, c, h, realm)));
                    }
                }
            }
            out
        }),
        ("npcHorsePurchaseProblem", |w, _, a| {
            let mut out = Vec::new();
            for c in &w.cities {
                for h in &w.horses {
                    for realm in &a.realm_ids {
                        out.push(d(horse_market::npc_horse_purchase_problem(w, c, h, realm)));
                    }
                }
            }
            out
        }),
        ("npcHorseOffers", |w, _, a| {
            let mut out = Vec::new();
            for c in &w.cities {
                for b in of_kind(w, &[BuildingKind::Stable], 8) {
                    for realm in &a.realm_ids {
                        out.push(d(horse_market::npc_horse_offers(w, c, b, realm)));
                    }
                }
            }
            out
        }),
        ("horsesToSell", |w, _, a| {
            let mut out = Vec::new();
            for c in &w.cities {
                for b in of_kind(w, &[BuildingKind::Stable], 8) {
                    for realm in &a.realm_ids {
                        out.push(d(horse_market::horses_to_sell(w, c, b, realm)));
                    }
                }
            }
            out
        }),
        ("npcHorseAt", |w, _, _| {
            let mut out = Vec::new();
            for r in &w.residents {
                for h in &w.horses {
                    let at = trade_quotes::npc_horse_at(w, r, h);
                    out.push(d(at.map(|(c, b)| (&c.id, &b.id))));
                }
            }
            out
        }),
        ("npcHorseBuyerAt", |w, _, a| {
            let mut out = Vec::new();
            for realm in &a.realm_ids {
                for r in &w.residents {
                    for h in &w.horses {
                        let at = trade_quotes::npc_horse_buyer_at(w, r, h, realm);
                        out.push(d(at.map(|(c, b)| (&c.id, &b.id))));
                    }
                }
            }
            out
        }),
        ("buyHorseProblem", |w, _, a| {
            let mut out = Vec::new();
            for realm in &a.realm_ids {
                for r in &w.residents {
                    for h in &a.horse_ids {
                        let h = Value::from(h.as_str());
                        out.push(d(trade_quotes::buy_horse_problem(w, realm, r, Some(&h))));
                    }
                }
            }
            out
        }),
        ("sellHorseProblem", |w, _, a| {
            let mut out = Vec::new();
            for realm in &a.realm_ids {
                for r in &w.residents {
                    for h in &a.horse_ids {
                        let h = Value::from(h.as_str());
                        out.push(d(trade_quotes::sell_horse_problem(w, realm, r, Some(&h))));
                    }
                }
            }
            out
        }),
        // horses.ts
        ("stableAt", |w, s, a| {
            a.tiles
                .iter()
                .map(|&(x, y)| d(riding::stable_index_at(w, x, y, s).map(|i| &w.buildings[i].id)))
                .collect()
        }),
        ("horseFood", |w, s, _| {
            w.horses
                .iter()
                .map(|h| {
                    let rider = w.residents.iter().position(|r| r.riding.as_deref() == Some(&h.id));
                    d(riding::horse_food(w, h, s, rider))
                })
                .collect()
        }),
        ("mountOffProblem", |w, _, a| {
            let mut out = Vec::new();
            for realm in &a.realm_ids {
                for r in &w.residents {
                    for h in &w.horses {
                        out.push(d(riding::mount_off_problem(w, r, h, realm)));
                    }
                }
            }
            out
        }),
        ("mountProblem", |w, _, a| {
            let mut out = Vec::new();
            for r in &w.residents {
                out.push(d(riding::mount_problem(w, r, None, Some(&a.terrain), None)));
                for h in &w.horses {
                    out.push(d(riding::mount_problem(w, r, Some(h), Some(&a.terrain), None)));
                }
            }
            out
        }),
        ("keptPair", |w, _, a| {
            let mut out = Vec::new();
            for b in of_kind(w, &[BuildingKind::Stable], 8) {
                for owner in owners(a) {
                    out.push(d(breeding::kept_pair(w, b, owner, None)));
                }
            }
            out
        }),
        ("breedingPair", |w, _, a| {
            let mut out = Vec::new();
            for b in of_kind(w, &[BuildingKind::Stable], 8) {
                for owner in owners(a) {
                    let pair = breeding::breeding_pair(w, b, owner, None);
                    out.push(d(pair.map(|[x, y]| [&x.id, &y.id])));
                }
            }
            out
        }),
        ("breedProblem", |w, _, a| {
            let mut out = Vec::new();
            for b in of_kind(w, &[BuildingKind::Stable], 8) {
                for owner in owners(a) {
                    out.push(d(breeding::breed_problem(w, b, owner, None, None)));
                }
            }
            out
        }),
        // leader.ts
        ("servesOthers", |w, _, a| {
            a.resident_ids.iter().map(|r| d(leader::serves_others(w, r))).collect()
        }),
        ("handOverProblem", |w, s, a| {
            let mut out = Vec::new();
            for (realm, leader_id) in &a.realms {
                let leader = w.residents.iter().find(|r| &r.id == leader_id);
                for target in &w.residents {
                    let realm = (realm.as_str(), leader_id.as_str());
                    out.push(d(leader::hand_over_problem(w, realm, leader, Some(target), s)));
                }
            }
            out
        }),
        ("heirProblem", |w, _, a| {
            let mut out = Vec::new();
            for (realm, leader_id) in &a.realms {
                for target in &w.residents {
                    let realm = (realm.as_str(), leader_id.as_str());
                    out.push(d(leader::heir_problem(w, realm, Some(target))));
                }
            }
            out
        }),
        // npc-trade.ts
        ("npcTradingStorageAt", |w, _, a| {
            a.tiles
                .iter()
                .map(|&(x, y)| {
                    let at = trade_quotes::npc_trading_storage_at(w, f64::from(x), f64::from(y));
                    d(at.map(|(c, b)| (&c.id, &b.id)))
                })
                .collect()
        }),
        ("quoteNpcTrade", |w, _, _| {
            let held = held();
            let mut out = Vec::new();
            for c in &w.cities {
                if let Some(storage) = npc_trade::npc_storages(w, c).first() {
                    for side in [TradeSide::Buy, TradeSide::Sell] {
                        for good in [Good::Food, Good::Wood, Good::Spear] {
                            let holder = TradeHolder { stock: &held, room: 200.0 };
                            let q = trade_quotes::quote_npc_trade(
                                w,
                                c,
                                storage,
                                holder,
                                side,
                                good,
                                10.0,
                                None,
                                &[],
                            );
                            out.push(d(q));
                        }
                    }
                }
            }
            out
        }),
        ("npcOfferTimes", |w, _, a| {
            let mut out = Vec::new();
            for c in &w.cities {
                for realm in &a.realm_ids {
                    let offer = OfferTerms {
                        realm_id: realm,
                        gives: Good::Food,
                        gives_units: 10.0,
                        wants: Good::Wood,
                        wants_units: 5.0,
                    };
                    out.push(trade_quotes::npc_offer_times(w, c, &offer, 5.0).to_string());
                }
            }
            out
        }),
        ("npcTradeProblem", |w, _, a| {
            trade_problems(w, a, |w, realm, r, side, good, units, city| {
                trade_quotes::npc_trade_problem(w, realm, r, side, good, units, None, city)
            })
        }),
        ("npcHorsesWanted", |w, _, _| {
            w.cities.iter().map(|c| npc_trade::npc_horses_wanted(w, c).to_string()).collect()
        }),
        ("npcStableKeep", |w, _, _| {
            let mut out = Vec::new();
            for c in &w.cities {
                for b in of_kind(w, &[BuildingKind::Stable], 8) {
                    out.push(npc_trade::npc_stable_keep(w, c, b).to_string());
                }
            }
            out
        }),
        ("npcStablesLack", |w, _, _| {
            w.cities.iter().map(|c| npc_trade::npc_stables_lack(w, c).to_string()).collect()
        }),
        ("npcNeedsScale", |w, _, _| {
            w.cities.iter().map(|c| npc_trade::npc_needs_scale(w, c).to_string()).collect()
        }),
        ("isBigNpcCity", |w, _, _| {
            w.cities.iter().map(|c| npc_trade::is_big_npc_city(w, c).to_string()).collect()
        }),
        ("npcReserve", |w, _, _| {
            w.cities.iter().map(|c| d(npc_trade::npc_reserve(w, c))).collect()
        }),
        ("standingSwing", |w, _, a| {
            let mut out = Vec::new();
            for c in &w.cities {
                out.push(npc_trade::standing_swing(w, c, None).to_string());
                for realm in &a.realm_ids {
                    out.push(npc_trade::standing_swing(w, c, Some(realm)).to_string());
                }
            }
            out
        }),
        ("npcCityPrices", |w, _, a| {
            let mut out = Vec::new();
            for c in &w.cities {
                out.push(d(npc_trade::npc_city_prices(w, c, None)));
                for realm in &a.realm_ids {
                    out.push(d(npc_trade::npc_city_prices(w, c, Some(realm))));
                }
            }
            out
        }),
        ("npcHirePrice", |w, _, a| {
            let mut out = Vec::new();
            for c in &w.cities {
                for realm in &a.realm_ids {
                    out.push(npc_trade::npc_hire_price(w, c, realm).to_string());
                }
            }
            out
        }),
        // offers.ts
        ("offersAt", |w, _, _| {
            of_kind(w, STORAGES, 12)
                .into_iter()
                .map(|b| d(offers::offers_at(w, &b.id).iter().map(|o| &o.id).collect::<Vec<_>>()))
                .collect()
        }),
        ("setAsideAt", |w, _, _| {
            of_kind(w, STORAGES, 12)
                .into_iter()
                .map(|b| d(offers::set_aside_at(w, &b.id)))
                .collect()
        }),
        ("freeStock", |w, _, _| {
            of_kind(w, STORAGES, 12)
                .into_iter()
                .map(|b| d(offers::free_stock(w, &b.id, b.stock.as_ref())))
                .collect()
        }),
        ("offerStorage", |w, _, a| {
            let mut out = Vec::new();
            for realm in &a.realm_ids {
                for b in of_kind(w, STORAGES, 12) {
                    out.push(bid(offers::offer_storage(w, realm, &b.id)));
                }
            }
            out
        }),
        ("timesToPost", |w, _, _| {
            of_kind(w, STORAGES, 12)
                .into_iter()
                .map(|b| offers::times_to_post(w, b, Good::Food, 5.0, 3.0).to_string())
                .collect()
        }),
        ("postOfferProblem", |w, _, a| {
            let mut out = Vec::new();
            for realm in &a.realm_ids {
                for b in of_kind(w, STORAGES, 12) {
                    out.push(d(offers::post_offer_problem(w, realm, &offer_terms(&b.id))));
                }
            }
            out
        }),
        ("acceptOfferProblem", |w, _, a| {
            let times = Value::from(1);
            let mut out = Vec::new();
            for r in &w.residents {
                let side = r.owner.as_deref().unwrap_or("-");
                for o in &a.offer_ids {
                    let o = Value::from(o.as_str());
                    out.push(d(offers::accept_offer_problem(
                        w,
                        side,
                        r,
                        Some(&o),
                        Some(&times),
                        None,
                    )));
                }
            }
            out
        }),
        // persuasion.ts
        ("respectSeenBy", |w, s, a| {
            let mut out = Vec::new();
            for c in &w.cities {
                for o in &a.orgs {
                    out.push(persuasion::respect_seen_by(w, c, o, s).to_string());
                }
            }
            out
        }),
        ("cityStrength", |w, _, _| {
            w.cities.iter().map(|c| persuasion::city_strength(w, c).to_string()).collect()
        }),
        ("holdsHigh", |w, _, a| {
            let mut out = Vec::new();
            for c in &w.cities {
                for realm in &a.realm_ids {
                    out.push(persuasion::holds_high(w, c, realm).to_string());
                }
            }
            out
        }),
        ("persuadedBy", |w, s, a| {
            let mut out = Vec::new();
            for c in &w.cities {
                for realm in &a.realm_ids {
                    out.push(persuasion::persuaded_by(w, c, realm, s).to_string());
                }
            }
            out
        }),
        // relocate.ts
        ("relocateRoom", |w, _, a| {
            let ordered = HashSet::new();
            a.city_ids.iter().map(|c| people::relocate_room(w, c, &ordered).to_string()).collect()
        }),
        ("relocateProblem", |w, _, a| {
            let mut out = Vec::new();
            for realm in &a.realm_ids {
                for r in &w.residents {
                    for c in &a.city_ids {
                        out.push(d(people::relocate_problem(w, realm, &[r], Some(c))));
                    }
                }
            }
            out
        }),
        // standing.ts
        ("standingOrganization", |w, _, a| {
            a.orgs.iter().map(|o| standing::standing_organization(w, o).to_string()).collect()
        }),
        ("standingOf", |w, _, a| {
            let mut out = Vec::new();
            for x in &a.orgs {
                for y in &a.orgs {
                    out.push(standing::standing_of(w, x, y).to_string());
                }
            }
            out
        }),
        ("tradeCoinsPerPoint", |w, _, a| {
            let mut out = Vec::new();
            for x in &a.orgs {
                for y in &a.orgs {
                    out.push(standing::trade_coins_per_point(w, x, y).to_string());
                }
            }
            out
        }),
        ("organizationLabel", |w, _, a| {
            a.orgs.iter().map(|o| standing::organization_label(w, o)).collect()
        }),
        ("standingsFor", |w, _, a| {
            a.realm_ids.iter().map(|r| d(standing::standings_for(w, r))).collect()
        }),
        ("tradeOrgRefuses", |w, _, a| {
            a.orgs.iter().map(|o| trade_org::trade_org_refuses(w, o).to_string()).collect()
        }),
        // swap.ts
        ("quoteSwap", |w, _, _| {
            let held = held();
            of_kind(w, &[BuildingKind::Warehouse], 8)
                .into_iter()
                .map(|b| {
                    let holder = TradeHolder { stock: &held, room: 200.0 };
                    d(trade_quotes::quote_swap(w, b, holder, Good::Food, Good::Wood, 10.0, 0.0))
                })
                .collect()
        }),
        ("quoteNpcSwap", |w, _, _| {
            let held = held();
            let mut out = Vec::new();
            for c in &w.cities {
                if let Some(storage) = npc_trade::npc_storages(w, c).first() {
                    let holder = TradeHolder { stock: &held, room: 200.0 };
                    let q = trade_quotes::quote_npc_swap(
                        w,
                        c,
                        storage,
                        holder,
                        Good::Food,
                        Good::Wood,
                        10.0,
                        None,
                    );
                    out.push(d(q));
                }
            }
            out
        }),
        ("swapProblem", |w, _, a| {
            let (give, want, units) = (Value::from("food"), Value::from("wood"), Value::from(5));
            let mut out = Vec::new();
            for realm in &a.realm_ids {
                for r in &w.residents {
                    let p = trade_quotes::swap_problem(
                        w,
                        realm,
                        r,
                        Some(&give),
                        Some(&want),
                        Some(&units),
                        None,
                    );
                    out.push(d(p));
                }
            }
            out
        }),
        // trade-org.ts
        ("ofTradeOrgHq", |w, _, _| {
            w.residents.iter().map(|r| trade_org::of_trade_org_hq(w, r).to_string()).collect()
        }),
        ("contractSide", |w, _, _| {
            w.residents.iter().map(|r| d(trade_org::contract_side(w, r))).collect()
        }),
        ("inInnerRing", |w, s, a| {
            a.near
                .iter()
                .map(|&(x, y)| {
                    trade_org::in_inner_ring(w, (f64::from(x), f64::from(y)), s).to_string()
                })
                .collect()
        }),
        ("strongestArmed", |w, _, _| vec![trade_org::strongest_armed(w).to_string()]),
        ("tradeOrgArmyWanted", |w, _, _| vec![trade_org::trade_org_army_wanted(w).to_string()]),
        ("punishers", |w, _, _| vec![d(sorted(trade_org::punishers(w)))]),
        // trader-trade.ts
        ("traderStanding", |w, _, _| {
            w.traders.iter().map(|t| d(trader_trade::trader_standing(w, t))).collect()
        }),
        ("traderVisitsTo", |w, _, a| {
            a.realm_ids.iter().map(|r| d(trader_trade::trader_visits_to(w, r))).collect()
        }),
        ("traderStandingAt", |w, _, a| {
            a.tiles
                .iter()
                .map(|&(x, y)| {
                    d(trade_quotes::trader_standing_at(w, f64::from(x), f64::from(y))
                        .map(|t| &t.id))
                })
                .collect()
        }),
        ("quoteWithTrader", |w, _, _| {
            let held = held();
            let mut out = Vec::new();
            for t in &w.traders {
                if let Some(k) = w.carriages.iter().find(|k| k.id == t.carriage_id) {
                    for side in [TradeSide::Buy, TradeSide::Sell] {
                        let holder = TradeHolder { stock: &held, room: 200.0 };
                        let q = trade_quotes::quote_with_trader(
                            w,
                            t,
                            k,
                            holder,
                            side,
                            Good::Food,
                            10.0,
                            &[],
                        );
                        out.push(d(q));
                    }
                }
            }
            out
        }),
        ("traderTradeProblem", |w, _, a| {
            trade_problems(w, a, |w, realm, r, side, good, units, city| {
                trade_quotes::trader_trade_problem(w, realm, r, side, good, units, None, city)
            })
        }),
        // transfer.ts
        ("nearestWarehouse", |w, s, _| {
            of_kind(w, STORAGES, 12)
                .into_iter()
                .map(|b| bid(transfer::nearest_warehouse(w, (b.x, b.y), s)))
                .collect()
        }),
        ("transferProblem", |w, _, a| {
            let (good, units) = (Value::from("food"), Value::from(5));
            let mut out = Vec::new();
            for realm in &a.realm_ids {
                for c in &a.city_ids {
                    let c = Value::from(c.as_str());
                    out.push(d(transfer::transfer_problem(
                        w,
                        realm,
                        Some(&good),
                        Some(&units),
                        Some(&c),
                    )));
                }
            }
            out
        }),
        ("pickUpTransferProblem", |w, _, a| {
            let (good, units) = (Value::from("food"), Value::from(5));
            let mut out = Vec::new();
            for realm in &a.realm_ids {
                for from in &a.city_ids {
                    for to in &a.city_ids {
                        let (f, t) = (Value::from(from.as_str()), Value::from(to.as_str()));
                        let p = transfer::pick_up_transfer_problem(
                            w,
                            realm,
                            Some(&f),
                            Some(&good),
                            Some(&units),
                            Some(&t),
                        );
                        out.push(d(p));
                    }
                }
            }
            out
        }),
        ("handInProblem", |w, _, a| {
            let (good, units) = (Value::from("food"), Value::from(5));
            let mut out = Vec::new();
            for r in &w.residents {
                let realm = r.owner.as_deref().unwrap_or("-");
                for c in &a.city_ids {
                    let c = Value::from(c.as_str());
                    let p = transfer::hand_in_problem(
                        w,
                        realm,
                        r,
                        Some(&good),
                        Some(&units),
                        None,
                        Some(&c),
                    );
                    out.push(d(p));
                }
            }
            out
        }),
        // vessels.ts
        ("besideVessel", |w, _, a| {
            let mut out = Vec::new();
            for v in &w.vessels {
                for &(x, y) in &a.near {
                    out.push(vessels::beside_vessel(w, v, f64::from(x), f64::from(y)).to_string());
                }
            }
            out
        }),
        ("boardVesselProblem", |w, _, _| {
            let mut out = Vec::new();
            for r in &w.residents {
                for v in &w.vessels {
                    for crew in [false, true] {
                        out.push(d(vessels::board_vessel_problem(w, r, v, crew)));
                    }
                }
            }
            out
        }),
        ("rowOffProblem", |w, _, a| {
            let mut out = Vec::new();
            for realm in &a.realm_ids {
                for r in &w.residents {
                    for v in &w.vessels {
                        out.push(d(vessels::row_off_problem(w, r, v, realm)));
                    }
                }
            }
            out
        }),
        // walls.ts
        ("shutOut", |w, _, _| vec![d(wall_rules::shut_out(w))]),
        ("wallsKey", |w, _, _| vec![wall_rules::walls_key(w)]),
        ("wallMap", |w, _, a| {
            let map = wall_rules::wall_map(w, &a.terrain);
            let mut tiles: Vec<_> = map.tiles.iter().map(|(t, x)| format!("{t} {x:?}")).collect();
            tiles.sort();
            // The tiles shut in, by how many and their sum: their list is long.
            let inside = (map.inside.len(), map.inside.iter().sum::<usize>());
            vec![d(tiles), d(inside)]
        }),
        ("climbLanding", |w, _, a| {
            of_kind(w, WALLS, 40)
                .into_iter()
                .map(|b| {
                    let wall = (b.x as i32, b.y as i32);
                    d(wall_rules::climb_landing(w, &a.terrain, (wall.0 - 1, wall.1), wall))
                })
                .collect()
        }),
        ("foreignWall", |w, _, a| {
            let mut out = Vec::new();
            for realm in a.realm_ids.iter().map(|r| Some(r.as_str())).chain([None]) {
                for b in of_kind(w, WALLS, 40) {
                    out.push(d(walls::foreign_wall(w, realm, &b.id).map(|x| &x.id)));
                }
            }
            out
        }),
        // warehouse.ts
        ("warehouseKeeps", |w, _, _| {
            of_kind(w, STORAGES, 12)
                .into_iter()
                .map(|b| d(warehouse::warehouse_keeps(w, b)))
                .collect()
        }),
        ("stockFloor", |w, _, _| {
            of_kind(w, STORAGES, 12).into_iter().map(|b| d(warehouse::stock_floor(w, b))).collect()
        }),
        ("warehousePrices", |w, _, _| {
            of_kind(w, STORAGES, 12)
                .into_iter()
                .map(|b| d(warehouse::warehouse_prices(w, b)))
                .collect()
        }),
        ("tradeCoinWarehouse", |w, _, _| {
            of_kind(w, STORAGES, 12)
                .into_iter()
                .map(|b| bid(warehouse::trade_coin_warehouse(w, b)))
                .collect()
        }),
        ("quoteTrade", |w, _, _| {
            let held = held();
            let mut out = Vec::new();
            for b in of_kind(w, &[BuildingKind::Warehouse], 8) {
                for side in [TradeSide::Buy, TradeSide::Sell] {
                    for good in [Good::Food, Good::Wood, Good::Spear] {
                        let holder = TradeHolder { stock: &held, room: 200.0 };
                        let q =
                            warehouse_trade::quote_trade(w, b, holder, side, good, 10.0, 0.0, &[]);
                        out.push(d(q));
                    }
                }
            }
            out
        }),
        ("tradeProblem", |w, _, a| {
            trade_problems(w, a, |w, realm, r, side, good, units, city| {
                warehouse_trade::trade_problem(w, realm, r, side, good, units, None, city)
            })
        }),
        ("buyOffCoinWarehouseAt", |w, _, a| {
            a.tiles
                .iter()
                .map(|&(x, y)| {
                    bid(warehouse_trade::buy_off_coin_warehouse_at(w, f64::from(x), f64::from(y)))
                })
                .collect()
        }),
        ("buyOffProblem", |w, _, a| {
            let mut out = Vec::new();
            for r in &w.residents {
                let realm = r.owner.as_deref().unwrap_or("-");
                out.push(d(warehouse_trade::buy_off_problem(w, realm, r, None, None)));
                for x in &a.directive_ids {
                    let x = Value::from(x.as_str());
                    out.push(d(warehouse_trade::buy_off_problem(w, realm, r, Some(&x), None)));
                }
            }
            out
        }),
        ("debtOf", |w, _, a| {
            a.orgs.iter().map(|o| warehouse_trade::debt_of(w, o).to_string()).collect()
        }),
        ("payDebtProblem", |w, _, _| {
            let coins = Value::from(10);
            w.residents
                .iter()
                .map(|r| {
                    let realm = r.owner.as_deref().unwrap_or("-");
                    d(warehouse_trade::pay_debt_problem(w, realm, r, Some(&coins), None))
                })
                .collect()
        }),
        ("quoteDelivery", |w, _, _| {
            let payer = held();
            let mut out = Vec::new();
            for b in of_kind(w, &[BuildingKind::Warehouse], 8) {
                for good in [Good::Food, Good::Iron] {
                    let q = warehouse_trade::quote_delivery(w, b, &payer, good, 10.0, 40.0, 0.0);
                    out.push(d(q));
                }
            }
            out
        }),
        ("quotePickUp", |w, _, _| {
            let mut out = Vec::new();
            for b in of_kind(w, &[BuildingKind::Warehouse], 8) {
                for good in [Good::Food, Good::Iron] {
                    let q = warehouse_trade::quote_pick_up(w, b, good, 10.0, 0.0, 40.0, 100.0);
                    out.push(d(q));
                }
            }
            out
        }),
        ("owedBy", |w, _, _| {
            let mut out = Vec::new();
            for b in of_kind(w, &[BuildingKind::Warehouse], 8) {
                for good in [Good::Food, Good::Iron] {
                    out.push(warehouse_trade::owed_by(w, &b.id, good).to_string());
                }
            }
            out
        }),
        // The rules that take the world's lists.
        ("teacherAt", |w, s, _| {
            of_kind(w, &[BuildingKind::TrainingGround], 12)
                .into_iter()
                .map(|b| d(building::teacher_at(b, &w.residents, s).map(|r| &r.id)))
                .collect()
        }),
        ("traineesOf", |w, s, _| {
            of_kind(w, &[BuildingKind::TrainingGround], 12)
                .into_iter()
                .map(|b| d(names(building::trainees_of(b, &w.residents, s))))
                .collect()
        }),
        ("workingOn", |w, s, _| {
            let mut out = Vec::new();
            for b in &w.buildings {
                for tearing_down in [false, true] {
                    out.push(d(names(building::working_on(b, &w.residents, tearing_down, s))));
                }
            }
            out
        }),
        ("breedersAt", |w, _, _| {
            of_kind(w, &[BuildingKind::Stable], 8)
                .into_iter()
                .map(|b| d(names(breeding::breeders_at(&w.residents, b))))
                .collect()
        }),
        ("horsesIn", |w, _, _| {
            of_kind(w, &[BuildingKind::Stable], 8)
                .into_iter()
                .map(|b| {
                    d(horses::horses_in(&w.horses, b).iter().map(|h| &h.id).collect::<Vec<_>>())
                })
                .collect()
        }),
        ("guardedBy", |w, _, _| {
            w.cities
                .iter()
                .map(|c| {
                    let guarded = guard::guarded_by(
                        &w.residents,
                        |r| r.city_id.as_deref() == Some(&c.id),
                        |r| r.owner.is_some(),
                        |r| r.down_until.is_some(),
                    );
                    guarded.to_string()
                })
                .collect()
        }),
    ]
}

/// The kinds built on and next to each resident's tile.
const KINDS_TO_BUILD: &[BuildingKind] = &[
    BuildingKind::House,
    BuildingKind::Storage,
    BuildingKind::Road,
    BuildingKind::Wall,
    BuildingKind::Farm,
    BuildingKind::Mine,
];

/// The Build lines: a road, a wooden wall and a stone wall.
const LINES: [(BuildingKind, Option<WallMaterial>); 3] = [
    (BuildingKind::Road, None),
    (BuildingKind::Wall, Some(WallMaterial::Wood)),
    (BuildingKind::Wall, Some(WallMaterial::Stone)),
];

const STORAGES: &[BuildingKind] = &[BuildingKind::Storage, BuildingKind::Warehouse];
const WALLS: &[BuildingKind] = &[BuildingKind::Wall, BuildingKind::Gate];

fn d<T: Debug>(x: T) -> String {
    format!("{x:?}")
}

fn bid(b: Option<&Building>) -> String {
    b.map_or_else(|| "-".to_string(), |b| b.id.clone())
}

fn sorted<T: Ord>(xs: impl IntoIterator<Item = T>) -> Vec<T> {
    let mut xs: Vec<T> = xs.into_iter().collect();
    xs.sort();
    xs
}

/// The first `n` buildings of these kinds, in the world's order.
fn of_kind<'w>(w: &'w WorldState, kinds: &[BuildingKind], n: usize) -> Vec<&'w Building> {
    w.buildings.iter().filter(|b| kinds.contains(&b.kind)).take(n).collect()
}

/// Goods a trader holds, for the quotes.
fn held() -> Stock {
    [(Good::Food, 20.0), (Good::Coins, 50.0), (Good::Wood, 10.0)].into_iter().collect()
}

/// An offer's terms at a storage: 10 Food for 5 Wood, twice.
fn offer_terms(storage_id: &str) -> Map<String, Value> {
    let terms = serde_json::json!({
        "storageId": storage_id,
        "gives": "food",
        "givesUnits": 10,
        "wants": "wood",
        "wantsUnits": 5,
        "times": 2,
    });
    terms.as_object().expect("an object").clone()
}

/// Each realm's and NPC city's horses.
fn owners(a: &Ask) -> Vec<HorseOwner<'_>> {
    let realms = a.realm_ids.iter().map(|r| HorseOwner::Realm(r));
    realms.chain(a.city_ids.iter().map(|c| HorseOwner::City(c))).collect()
}

type TradeCheck = fn(
    &WorldState,
    &str,
    &Resident,
    TradeSide,
    Option<&Value>,
    Option<&Value>,
    Option<&Value>,
) -> Option<String>;

/// A trade check for each realm, resident, city and side, of 5 Food.
fn trade_problems(w: &WorldState, a: &Ask, check: TradeCheck) -> Vec<String> {
    let (good, units) = (Value::from("food"), Value::from(5));
    let mut out = Vec::new();
    for realm in &a.realm_ids {
        for r in &w.residents {
            for c in a.city_ids.iter().map(|c| Some(Value::from(c.as_str()))).chain([None]) {
                for side in [TradeSide::Buy, TradeSide::Sell] {
                    out.push(d(check(w, realm, r, side, Some(&good), Some(&units), c.as_ref())));
                }
            }
        }
    }
    out
}

/// The rules that may answer otherwise on what a Player is sent, and what the mirror answers.
const DIFFERS: &[(&str, &str)] = &[
    // No realm is sent (`world.realms`): not their names, Leaders or cities as a realm's, so a
    // realm reads as fallen and a city of one as no realm's.
    ("realmName", "any realm: \"a fallen realm\""),
    ("organizationLabel", "a realm: \"a fallen realm\""),
    ("realmsKnownTo", "no realm"),
    ("realmsToOfferTo", "no realm"),
    ("realmsStandingTogether", "no realm"),
    ("directOfferProblem", "to any realm: \"send a direct offer to a realm\""),
    ("carriedOfferProblem", "to any realm: \"send a direct offer to a realm\""),
    ("transferProblem", "to any city: \"not a city of a realm\""),
    ("pickUpTransferProblem", "from any city: \"not a city of a realm\""),
    ("handInProblem", "to any city: \"not a city of a realm\""),
    // No standing is sent (`world.standings`): every one reads as 0, so an NPC city neither
    // refuses nor shuts its gates on anyone and its prices don't swing.
    ("standingOf", "0"),
    ("standingsFor", "none"),
    ("standingSwing", "0"),
    ("npcCityRefuses", "no city refuses"),
    ("sellsTo", "every NPC city for sale sells"),
    ("cityPrice", "a buyer's price at standing 0"),
    ("npcHirePrice", "the price at standing 0"),
    ("shutOut", "no city shuts anyone out"),
    ("wallsKey", "no city's gates shut to anyone"),
    ("wallMap", "no wall shut to anyone"),
    ("buyProblem", "never \"it holds you in too low standing\""),
    ("npcTradeProblem", "never \"won't trade with you\": the next reason"),
    ("swapProblem", "never \"won't trade with you\": the next reason"),
    ("buyHorseProblem", "never \"won't trade with you\": the next reason"),
    ("npcHorseSaleProblem", "never \"won't trade with you\": the next reason"),
    // Standings and an NPC city's stock not seen inside together.
    ("npcCityPrices", "prices at standing 0, on no stock"),
    ("npcHorseOffers", "prices at standing 0, and the city has no Coins for the horse"),
    ("horsesToSell", "prices at standing 0, and the city has no Coins for the horse"),
    ("npcHorsePurchaseProblem", "never \"won't trade with you\"; \"hasn't the coins\""),
    // No resource node is sent (`world.nodes`): a node's workplace can't go anywhere.
    ("nodeCorner", "none"),
];

fn names(rs: Vec<&csp_shared::world::Resident>) -> Vec<&str> {
    rs.into_iter().map(|r| r.id.as_str()).collect()
}

fn ask(world: &WorldState, size: i32) -> Ask {
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
    let mut near: Vec<_> = world
        .residents
        .iter()
        .flat_map(|r| {
            let (x, y) = (r.x as i32, r.y as i32);
            [(x, y), (x + 1, y), (x, y + 1), (x + 2, y + 2)]
        })
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    near.sort_unstable();
    let realm_ids: Vec<String> = world.realms.iter().map(|r| r.id.clone()).collect();
    let city_ids: Vec<String> = world.cities.iter().map(|c| c.id.clone()).collect();
    Ask {
        realms: world.realms.iter().map(|r| (r.id.clone(), r.leader_id.clone())).collect(),
        orgs: realm_ids.iter().chain(&city_ids).cloned().chain([TRADE_ORG.to_string()]).collect(),
        near,
        terrain: TerrainMap { size, tiles: vec![Terrain::Plains as u8; (size * size) as usize] },
        alliances: world.alliances.clone(),
        demands: world.demands.clone(),
        nodes: world.nodes.clone(),
        offer_ids: world.offers.iter().map(|o| o.id.clone()).chain(["-".to_string()]).collect(),
        directive_ids: world.directives.iter().map(|x| x.id.clone()).collect(),
        tiles,
        city_ids,
        building_ids: world.buildings.iter().map(|b| b.id.clone()).collect(),
        carriage_ids: world.carriages.iter().map(|k| k.id.clone()).collect(),
        horse_ids: world.horses.iter().map(|h| h.id.clone()).collect(),
        resident_ids: world.residents.iter().map(|r| r.id.clone()).collect(),
        realm_ids,
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
        let questions = ask(&world, size);
        // What the full world answers is the same for every realm.
        let full: Vec<_> =
            rules().into_iter().map(|(_, rule)| rule(&world, size, &questions)).collect();
        for realm in &world.realms {
            let mut mirror = SightMirror::new();
            let seen = entities_revealed(&world, &index, &realm.id);
            mirror.welcome(size, world.tick, seen.iter().cloned());
            let (m, w) = (mirror.world(), &world);
            assert_eq!(
                (m.residents.len(), m.buildings.len(), m.cities.len(), m.carriages.len()),
                (w.residents.len(), w.buildings.len(), w.cities.len(), w.carriages.len()),
                "{path} {}: the mirror holds what the realm sees, all of it",
                realm.id
            );
            for ((name, rule), full) in rules().into_iter().zip(&full) {
                asked += 1;
                let mirrored = rule(mirror.world(), size, &questions);
                if *full != mirrored {
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
    let agree: Vec<_> = documented.keys().filter(|name| !differed.contains_key(**name)).collect();
    assert!(agree.is_empty(), "rules in DIFFERS that answer the same on the mirror now: {agree:?}");
}

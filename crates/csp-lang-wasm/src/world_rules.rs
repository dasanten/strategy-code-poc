//! The checks that read the world (T122.6): whether a resident may build, steal, board, breed,
//! relocate or hand over the realm, and why not, answered by `csp-sim`'s own functions on the world
//! mirror. One entry, [`rule`], called by name with its arguments as a JSON array of ids,
//! coordinates and values, answering JSON, so a check is one arm here and one function in
//! `packages/lang-wasm/src/world-rules.ts`. Things are found in the mirror by id; one that isn't in
//! sight (gone in the message the client hasn't shown yet) gets the check's own "no such" answer.

use csp_shared::chunks::UNEXPLORED;
use csp_shared::terrain::wrap;
use csp_shared::world::{
    Alliance, AllianceArmyPart, AllianceArmyPartIs, BuildingKind, ContractSide, MercenaryContract,
    Resident, ResourceKind, ResourceNode, WallMaterial, WorldState,
};
use csp_sim::mirror::{Known, SightMirror};
use csp_sim::queries::building::{self, TerrainLookup};
use csp_sim::queries::horses::HorseOwner;
use csp_sim::queries::{breeding, driving, leader, people, riding, vessels};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};

/// The arguments of a call, read as the tuple the rule takes.
fn args<T: DeserializeOwned>(name: &str, json: &str) -> Result<T, String> {
    serde_json::from_str(json).map_err(|e| format!("{name}: {e}"))
}

/// The terrain the client knows around the tiles a check looks at: `w` × `h` tiles from (x, y)
/// east and south, row by row; any other tile reads as unexplored, where nothing is laid out.
#[derive(Deserialize)]
struct Patch {
    size: i32,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    tiles: Vec<u8>,
}

impl TerrainLookup for Patch {
    fn size(&self) -> i32 {
        self.size
    }
    fn at(&self, x: i32, y: i32) -> u8 {
        let dx = wrap(x - self.x, self.size);
        let dy = wrap(y - self.y, self.size);
        if dx >= self.w || dy >= self.h {
            return UNEXPLORED;
        }
        self.tiles.get((dy * self.w + dx) as usize).copied().unwrap_or(UNEXPLORED)
    }
}

/// The resource nodes the client explored that a check looks at, as (kind, x, y).
fn nodes(list: Vec<(ResourceKind, f64, f64)>) -> Vec<ResourceNode> {
    list.into_iter().map(|(kind, x, y)| ResourceNode::new("", kind, x, y)).collect()
}

/// What the client knows of the residents serving others (`diplomacy`): those handed over to its
/// alliance's army, and the residents of each of its realm's contracts, with whether it started.
fn serving(army: Vec<String>, contracts: Vec<(Vec<String>, bool)>) -> Known {
    let alliances = if army.is_empty() {
        Vec::new()
    } else {
        vec![Alliance {
            id: String::new(),
            name: String::new(),
            leader_id: String::new(),
            members: Vec::new(),
            invites: Vec::new(),
            army: army
                .into_iter()
                .map(|id| AllianceArmyPart {
                    is: AllianceArmyPartIs::Resident,
                    id,
                    recall_at: None,
                })
                .collect(),
        }]
    };
    let contracts = contracts
        .into_iter()
        .map(|(resident_ids, started)| MercenaryContract {
            id: String::new(),
            lender_id: String::new(),
            hirer_id: String::new(),
            offered_by: ContractSide::Lender,
            resident_ids,
            days: 0.0,
            price_per_week: 0.0,
            storage_id: String::new(),
            started_at: started.then_some(0.0),
            paid_weeks: 0.0,
        })
        .collect();
    Known { nodes: Vec::new(), alliances, contracts }
}

fn resident<'w>(w: &'w WorldState, id: &str) -> Option<&'w Resident> {
    w.residents.iter().find(|r| r.id == id)
}

/// An answer of a check: its refusal, or null when it allows.
fn problem(p: Option<impl Into<String>>) -> Value {
    p.map_or(Value::Null, |p| Value::String(p.into()))
}

/// Calls the world rule `name` with `json`, a JSON array of its arguments, on the mirror; answers
/// its result as JSON, or an error for a rule it doesn't know or arguments it can't read.
pub fn rule(mirror: &mut SightMirror, name: &str, json: &str) -> Result<Value, String> {
    let size = mirror.size();
    let w = mirror.world();
    let no = |what: &str| Ok(json!(format!("no such {what}")));
    Ok(match name {
        // Where buildings go (`CONTEXT.md`: Where buildings go, Wood or stone).
        "buildProblem" => {
            type A = (
                BuildingKind,
                i32,
                i32,
                Option<WallMaterial>,
                Patch,
                Vec<(ResourceKind, f64, f64)>,
            );
            let (kind, x, y, material, terrain, known): A = args(name, json)?;
            let known = Known { nodes: nodes(known), ..Known::default() };
            mirror.with_known(known, |w| {
                problem(building::build_problem_for(w, x, y, kind, material, Some(&terrain)))
            })
        }
        "nodeCorner" => {
            type A = ((ResourceKind, f64, f64), Patch, Vec<(ResourceKind, f64, f64)>);
            let ((kind, x, y), terrain, known): A = args(name, json)?;
            let node = ResourceNode::new("", kind, x, y);
            let known = Known { nodes: nodes(known), ..Known::default() };
            mirror.with_known(known, |w| json!(building::node_corner(w, &terrain, &node)))
        }
        // Stealing a carriage or horse (`CONTEXT.md`), its vessel part too.
        "driveOffProblem" => {
            let (thief, carriage, realm): (String, String, String) = args(name, json)?;
            let (Some(r), Some(k)) =
                (resident(w, &thief), w.carriages.iter().find(|k| k.id == carriage))
            else {
                return no("carriage");
            };
            problem(driving::drive_off_problem(w, r, k, &realm, size))
        }
        "hitchOffProblem" => {
            let (driver, carriage, realm, named): (String, String, String, Option<String>) =
                args(name, json)?;
            let (Some(r), Some(k)) =
                (resident(w, &driver), w.carriages.iter().find(|k| k.id == carriage))
            else {
                return no("carriage");
            };
            problem(driving::hitch_off_problem(w, r, k, &realm, named.as_deref()))
        }
        "horseToSteal" => {
            let (driver, carriage, realm, named): (String, String, String, Option<String>) =
                args(name, json)?;
            let (Some(r), Some(k)) =
                (resident(w, &driver), w.carriages.iter().find(|k| k.id == carriage))
            else {
                return Ok(Value::Null);
            };
            json!(driving::horse_to_steal(w, r, k, &realm, named.as_deref()).map(|h| &h.id))
        }
        "mountOffProblem" => {
            let (thief, horse, realm): (String, String, String) = args(name, json)?;
            let (Some(r), Some(h)) = (resident(w, &thief), w.horses.iter().find(|h| h.id == horse))
            else {
                return no("horse");
            };
            problem(riding::mount_off_problem(w, r, h, &realm))
        }
        "rowOffProblem" => {
            let (thief, vessel, realm): (String, String, String) = args(name, json)?;
            let (Some(r), Some(v)) =
                (resident(w, &thief), w.vessels.iter().find(|v| v.id == vessel))
            else {
                return no("boat");
            };
            problem(vessels::row_off_problem(w, r, v, &realm))
        }
        // Boarding a vessel (`CONTEXT.md`: Beside a vessel, Crew).
        "boardVesselProblem" => {
            let (who, vessel, as_crew): (String, String, bool) = args(name, json)?;
            let (Some(r), Some(v)) = (resident(w, &who), w.vessels.iter().find(|v| v.id == vessel))
            else {
                return no("boat");
            };
            problem(vessels::board_vessel_problem(w, r, v, as_crew))
        }
        // Breeding (`CONTEXT.md`).
        "breedProblem" => {
            type A = (String, Option<String>, Option<String>, Option<String>, Option<Vec<String>>);
            let (stable, realm, city, breeder, horses): A = args(name, json)?;
            let Some(b) = w.buildings.iter().find(|b| b.id == stable) else {
                return no("stable");
            };
            let owner = match (&realm, &city) {
                (Some(r), _) => HorseOwner::Realm(r),
                (None, Some(c)) => HorseOwner::City(c),
                (None, None) => return Err(format!("{name}: a horse owner")),
            };
            problem(breeding::breed_problem(w, b, owner, breeder.as_deref(), horses.as_deref()))
        }
        // Relocate (`CONTEXT.md`).
        "relocateProblem" => {
            let (realm, ids, city): (String, Vec<String>, Option<String>) = args(name, json)?;
            let rs: Option<Vec<&Resident>> = ids.iter().map(|id| resident(w, id)).collect();
            let Some(rs) = rs else { return no("resident") };
            problem(people::relocate_problem(w, &realm, &rs, city.as_deref()))
        }
        // Leader handover, Heir (`CONTEXT.md`).
        "handOverProblem" | "heirProblem" => {
            type A = (String, String, String, Vec<String>, Vec<(Vec<String>, bool)>);
            let (realm, leader_id, target, army, contracts): A = args(name, json)?;
            let heir = name == "heirProblem";
            mirror.with_known(serving(army, contracts), |w| {
                let t = resident(w, &target);
                problem(if heir {
                    leader::heir_problem(w, (&realm, &leader_id), t)
                } else {
                    let l = resident(w, &leader_id);
                    leader::hand_over_problem(w, (&realm, &leader_id), l, t, size)
                })
            })
        }
        _ => return Err(format!("no world rule {name}")),
    })
}

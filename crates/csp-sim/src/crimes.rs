//! Crimes and witnesses (`CONTEXT.md`: Crime, Witness, Lost post found out), ported from
//! `apps/server/src/crimes.ts`: what counts as an Organization, noting a crime, and spreading the
//! news of it until its victim knows.

use std::collections::{HashMap, HashSet};

use csp_shared::balance::{CRIME_MEMORY_DAYS, CRIME_STANDING_LOSS, SIGHT_RANGE};
use csp_shared::terrain::wrap_distance;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, Carriage, City, Crime, CrimeKind, Culprit, RealmEventWhat, Resident, Stock,
    Victim, WorldState,
};

use crate::pending::record_event;
use crate::queries::city_area::in_city_area;
use crate::standing::change_standing;

/// The Organization a resident belongs to (`organizationOf`): their realm, or for one of no realm
/// their city; None for one of neither.
pub fn organization_of(r: &Resident) -> Option<&str> {
    r.owner.as_deref().or(r.city_id.as_deref())
}

/// Whether an Organization is one of the Trade Organization's cities.
fn is_trade_org_city(world: &WorldState, org: &str) -> bool {
    world.cities.iter().any(|c| c.id == org && c.trade_org.is_some())
}

/// The Organization a city belongs to (`cityOrganization` of `crimes.ts`): its realm, or the city
/// itself when it has none. Not `territory`'s, which names the Trade Organization for its cities.
pub fn city_organization(c: &City) -> &str {
    c.realm_id.as_deref().unwrap_or(&c.id)
}

/// The Organization a building belongs to (`buildingOrganization`): through its city, or an
/// outpost storage's realm; a construction site laid out by a realm's resident is that realm's.
pub fn building_organization(world: &WorldState, b: &Building) -> Option<String> {
    if b.site.is_some() && b.realm_id.is_some() {
        return b.realm_id.clone();
    }
    match world.cities.iter().find(|c| b.city_id.as_ref() == Some(&c.id)) {
        Some(city) => Some(city_organization(city).to_string()),
        None => b.realm_id.clone(),
    }
}

/// The Organization a carriage belongs to (`carriageOrganization`): its realm, or its city.
pub fn carriage_organization(k: &Carriage) -> Option<&str> {
    k.realm_id.as_deref().or(k.city_id.as_deref())
}

/// An Organization's name for the log (`organizationName`): a realm by its realm name, a city by
/// its own.
pub fn organization_name(world: &WorldState, org: &str) -> String {
    if let Some(realm) = world.realms.iter().find(|x| x.id == org) {
        let name = realm.name.clone().or_else(|| {
            world.residents.iter().find(|x| x.id == realm.leader_id).map(|l| l.name.clone())
        });
        return match name {
            Some(n) => format!("the realm of {n}"),
            None => "a realm".to_string(),
        };
    }
    world.cities.iter().find(|c| c.id == org).map_or_else(|| "nobody".to_string(), |c| c.name.clone())
}

/// What a crime was against, besides its Organization (`CrimeAgainst`). `victim` is a resident id.
#[derive(Debug, Clone, Default)]
pub struct CrimeAgainst {
    pub victim_org: Option<String>,
    pub victim: Option<String>,
    pub goods: Option<Stock>,
    pub carriage: bool,
    pub horse: Option<String>,
    pub building: Option<BuildingKind>,
    pub post: Option<String>,
}

/// Notes a crime by the resident `culprit_id` (`commitCrime`), on a map of `size` tiles. It is
/// one only against another Organization. Its witnesses are the living residents of any other
/// Organization than the culprit's within sight range of the culprit. Thefts of goods by the same
/// resident from the same Organization on the same tile, not yet known to it, add up into one.
pub fn commit_crime(world: &mut WorldState, size: i32, kind: CrimeKind, culprit_id: &str, against: CrimeAgainst) {
    let Some(culprit) = world.residents.iter().find(|r| r.id == culprit_id) else { return };
    let Some(org) = organization_of(culprit).map(str::to_string) else { return };
    let CrimeAgainst { victim_org, victim, goods, carriage, horse, building, post } = against;
    let Some(victim_org) = victim_org else { return };
    if victim_org == org {
        return;
    }
    // The Trade Organization's cities are one Organization: a caravan moving its stock steals nothing.
    if is_trade_org_city(world, &org) && is_trade_org_city(world, &victim_org) {
        return;
    }
    let (cx, cy) = (culprit.x, culprit.y);
    let at = (cx as i32, cy as i32);
    let witnesses: Vec<String> = world
        .residents
        .iter()
        .filter(|r| r.health > 0.0 && r.id != culprit_id && wrap_distance(size, (r.x as i32, r.y as i32), at) <= SIGHT_RANGE)
        .filter(|r| organization_of(r).is_some_and(|theirs| theirs != org))
        .map(|r| r.id.clone())
        .collect();
    let (culprit_name, victim) = (
        culprit.name.clone(),
        victim.and_then(|id| world.residents.iter().find(|r| r.id == id)).map(|v| Victim {
            resident_id: v.id.clone(),
            name: v.name.clone(),
        }),
    );
    if kind == CrimeKind::Theft && !carriage && horse.is_none() {
        let open = world.crimes.iter_mut().find(|c| {
            c.kind == CrimeKind::Theft
                && c.carriage.is_none()
                && c.horse.is_none()
                && c.culprit.resident_id == culprit_id
                && c.victim_org == victim_org
                && c.x == cx
                && c.y == cy
                && !c.known_by.contains(&victim_org)
        });
        if let Some(open) = open {
            let kept = open.goods.get_or_insert_with(Stock::new);
            for (good, units) in goods.iter().flatten() {
                *kept.entry(*good).or_insert(0.0) += units;
            }
            for w in witnesses {
                if !open.witnesses.contains(&w) {
                    open.witnesses.push(w);
                }
            }
            return;
        }
    }
    let id = format!("x{}", world.next_id);
    world.next_id += 1;
    let org_name = organization_name(world, &org);
    world.crimes.push(Crime {
        id,
        kind,
        tick: world.tick as f64,
        x: cx,
        y: cy,
        culprit: Culprit { resident_id: culprit_id.to_string(), name: culprit_name, org, org_name },
        victim_org,
        victim,
        goods,
        carriage: carriage.then_some(true),
        horse,
        building,
        post,
        witnesses,
        known_by: Vec::new(),
        heard_at: None,
        punished: None,
    });
}

/// Who stole from an Organization, as far as it knows (`knownThieves`): the culprits of thefts
/// from it that it knows of or one of its residents saw.
pub fn known_thieves(world: &WorldState, org: &str) -> HashSet<String> {
    let thefts: Vec<&Crime> =
        world.crimes.iter().filter(|c| c.kind == CrimeKind::Theft && c.victim_org == org).collect();
    if thefts.is_empty() {
        return HashSet::new();
    }
    let ours: HashSet<&str> = world
        .residents
        .iter()
        .filter(|r| organization_of(r) == Some(org))
        .map(|r| r.id.as_str())
        .collect();
    thefts
        .into_iter()
        .filter(|c| c.known_by.iter().any(|k| k == org) || c.witnesses.iter().any(|id| ours.contains(id.as_str())))
        .map(|c| c.culprit.resident_id.clone())
        .collect()
}

/// Whether a captured post's crime still waits for a wandering trader to find it out
/// (`awaitsTrader`): the Trade Organization hasn't heard, and it is on a loop.
pub fn awaits_trader(world: &WorldState, crime: &Crime) -> bool {
    let Some(post) = &crime.post else { return false };
    if crime.known_by.contains(&crime.victim_org) {
        return false;
    }
    world.traders.iter().any(|t| t.r#loop.contains(post))
}

/// Spreads news of crimes (`stepCrimes`), on a map of `size` tiles. A witness who died takes the
/// news with them, and so does one who has since joined the culprit's Organization. One standing
/// in the area of a city of their own Organization makes the crime known to it, and is done. News
/// of a captured post goes to the Trade Organization from any of its cities. A crime nobody carries
/// news of any more is forgotten at once when nobody knows it (unless a trader may still find it
/// out), and `CRIME_MEMORY_DAYS` after it happened otherwise, or for a captured post after the news.
pub fn step_crimes(world: &mut WorldState, size: i32) {
    if world.crimes.is_empty() {
        return;
    }
    let by_id: HashMap<&str, usize> =
        world.residents.iter().enumerate().map(|(i, r)| (r.id.as_str(), i)).collect();
    // Who learns what, in the order the TypeScript learns it: crime by crime, witness by witness.
    let mut learnt: Vec<(usize, String)> = Vec::new();
    let mut kept_witnesses: Vec<Vec<String>> = Vec::with_capacity(world.crimes.len());
    for (ci, crime) in world.crimes.iter().enumerate() {
        let mut known: Vec<String> = crime.known_by.clone();
        let kept = crime
            .witnesses
            .iter()
            .filter(|id| {
                let Some(w) = by_id.get(id.as_str()).map(|&i| &world.residents[i]) else { return false };
                if w.health <= 0.0 {
                    return false;
                }
                let Some(org) = organization_of(w) else { return true };
                if org == crime.culprit.org {
                    return false;
                }
                let lost_post = crime.kind == CrimeKind::Capture
                    && is_trade_org_city(world, org)
                    && is_trade_org_city(world, &crime.victim_org);
                let home = world.cities.iter().any(|c| {
                    (if lost_post { c.trade_org.is_some() } else { city_organization(c) == org })
                        && in_city_area(world, &c.id, w.x, w.y, size)
                });
                if !home {
                    return true;
                }
                let hears = if lost_post { crime.victim_org.clone() } else { org.to_string() };
                if !known.contains(&hears) {
                    known.push(hears.clone());
                    learnt.push((ci, hears));
                }
                false
            })
            .cloned()
            .collect();
        kept_witnesses.push(kept);
    }
    // `learn` changes standings, events and the crime itself, never what the filter reads.
    for (crime, kept) in world.crimes.iter_mut().zip(kept_witnesses) {
        crime.witnesses = kept;
    }
    for (ci, org) in learnt {
        learn(world, ci, &org);
    }
    let memory = CRIME_MEMORY_DAYS * TICKS_PER_GAME_DAY;
    let tick = world.tick as f64;
    let keep: Vec<bool> = world
        .crimes
        .iter()
        .map(|c| {
            !c.witnesses.is_empty()
                || (!c.known_by.is_empty() && tick - c.heard_at.unwrap_or(c.tick) < memory)
                || awaits_trader(world, c)
        })
        .collect();
    let mut keep = keep.into_iter();
    world.crimes.retain(|_| keep.next().unwrap_or(false));
}

/// `org` learns of the crime at `ci` (`learn`). When it is the victim, its standing toward the
/// culprit's Organization falls and its realm logs it.
fn learn(world: &mut WorldState, ci: usize, org: &str) {
    let tick = world.tick as f64;
    let crime = &mut world.crimes[ci];
    crime.known_by.push(org.to_string());
    if org != crime.victim_org {
        return;
    }
    if crime.kind == CrimeKind::Capture {
        crime.heard_at = Some(tick);
    }
    let crime = crime.clone();
    let loss = match crime.kind {
        CrimeKind::Theft => CRIME_STANDING_LOSS.theft,
        CrimeKind::Attack => CRIME_STANDING_LOSS.attack,
        CrimeKind::Killing => CRIME_STANDING_LOSS.killing,
        CrimeKind::TearDown => CRIME_STANDING_LOSS.tear_down,
        CrimeKind::Capture => CRIME_STANDING_LOSS.capture,
    };
    change_standing(world, org, &crime.culprit.org, -loss);
    record_event(
        world,
        Some(org),
        RealmEventWhat::CrimeKnown {
            crime_id: crime.id,
            crime: crime.kind,
            at: crime.tick,
            x: crime.x,
            y: crime.y,
            culprit_id: crime.culprit.resident_id,
            culprit: crime.culprit.name,
            culprit_org: crime.culprit.org_name,
            victim: crime.victim.map(|v| v.name),
            goods: crime.goods,
            carriage: crime.carriage,
            horse: crime.horse,
            building: crime.building,
        },
    );
}

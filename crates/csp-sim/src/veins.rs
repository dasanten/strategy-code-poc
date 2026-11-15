//! Running dry (`CONTEXT.md`: Running dry; Epic 102): a normal or rich ore node holds a stock,
//! and each unit a workplace makes on it takes one from it. At zero the node is gone for good:
//! the workplace on it stays a building and makes nothing, the log of each realm working it says
//! so once, and a Player who explored the tile keeps the node on their map until they see the
//! tile again.

use csp_shared::balance::MAP_SIZE;
use csp_shared::footprint::covers;
use csp_shared::world::{Building, DryNode, RealmEventWhat, ResidentOrder, WorldState};

use crate::events::record_event;
use crate::invariants::{js_number, violation};
use crate::queries::city::building_realm;
use crate::queries::names::placed;
use crate::sight::{Eyes, InvariantViolation, Spot};

/// What taking a unit from a vein came to (`take_from_vein`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Take {
    /// The unit may be made: taken from the stock, or there is no stock to keep.
    Made,
    /// The unit may be made, and it was the vein's last: the node ran dry.
    Last,
    /// Nothing is left to make it from.
    Nothing,
}

/// Takes one unit from the stock of the node `workplace` stands on, as it makes one, and runs the
/// node dry when that was its last (`run_dry`). A workplace on no node, or on one that never runs
/// dry, has no stock to keep.
pub fn take_from_vein(world: &mut WorldState, workplace: &Building) -> Take {
    let Some(ni) = world
        .nodes
        .iter()
        .position(|n| covers(placed(workplace), n.x as i32, n.y as i32, MAP_SIZE))
    else {
        return Take::Made;
    };
    let Some(stock) = world.nodes[ni].stock.as_mut() else { return Take::Made };
    if stock.left < 1.0 {
        return Take::Nothing;
    }
    stock.left -= 1.0;
    stock.made += 1.0;
    if stock.left >= 1.0 {
        return Take::Made;
    }
    run_dry(world, ni, workplace);
    Take::Last
}

/// The node at `ni` runs dry under `workplace`: it leaves the world, is kept as a dry node for
/// the Players who remember it, and the workplace's realm log says so.
fn run_dry(world: &mut WorldState, ni: usize, workplace: &Building) {
    let node = world.nodes.remove(ni);
    world.dry_nodes.push(DryNode {
        id: node.id,
        kind: node.kind,
        x: node.x,
        y: node.y,
        richness: node.richness,
        at: world.tick,
        seen_gone_by: Vec::new(),
        next: None,
    });
    // A workplace on a node is of no realm: the realms working it are told, once each.
    let mut realms: Vec<String> =
        building_realm(world, workplace).map(str::to_owned).into_iter().collect();
    for r in &world.residents {
        let works =
            matches!(&r.order, Some(ResidentOrder::WorkAt(o)) if o.building_id == workplace.id);
        if let Some(owner) = r.owner.as_ref().filter(|o| works && !realms.contains(o)) {
            realms.push(owner.clone());
        }
    }
    for realm in realms {
        record_event(
            world,
            Some(&realm),
            RealmEventWhat::VeinRanDry {
                building_id: workplace.id.clone(),
                node: node.kind,
                x: node.x,
                y: node.y,
            },
        );
    }
}

/// Notes that the Player `user_id` sees the tiles of the dry nodes their `eyes` see, so they know
/// those nodes are gone (`CONTEXT.md`: Running dry, Last seen). Returns whether they learnt of any.
pub fn see_dry_nodes(world: &mut WorldState, user_id: u64, eyes: &Eyes) -> bool {
    let mut learnt = false;
    for dry in &mut world.dry_nodes {
        if !dry.seen_gone_by.contains(&user_id) && eyes.sees(Spot { x: dry.x, y: dry.y }) {
            dry.seen_gone_by.push(user_id);
            learnt = true;
        }
    }
    learnt
}

/// The tiles of the dry nodes the Player knows are gone, in the order they ran dry: their map
/// leaves out any node there (`CONTEXT.md`: Running dry). A tile where the node came back and the
/// Player has seen it since is not one.
pub fn gone_nodes_of(world: &WorldState, user_id: u64) -> Vec<(i32, i32)> {
    let back = |d: &DryNode| {
        world.nodes.iter().any(|n| {
            n.x as i32 == d.x as i32
                && n.y as i32 == d.y as i32
                && !crate::new_veins::vein_unseen_by(world, &n.id, user_id)
        })
    };
    world
        .dry_nodes
        .iter()
        .filter(|d| d.seen_gone_by.contains(&user_id) && !back(d))
        .map(|d| (d.x as i32, d.y as i32))
        .collect()
}

/// The veins' health check (`CONTEXT.md`: Running dry; ADR 0004): a node's stock never goes below
/// zero, what was made from it plus what is left is what it came into being with, a node that
/// never runs dry (poor, forest, stone) has no stock, and a node with nothing left is gone.
pub fn veins_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let name = "veins-sound";
    let mut out = Vec::new();
    for n in &world.nodes {
        let Some(s) = &n.stock else { continue };
        let mut fail =
            |m: String| out.push(violation(name, format!("node {} {m}", n.id), &[&n.id]));
        if !n.runs_dry() {
            fail("never runs dry but holds a stock".into());
        }
        if s.left < 0.0 || s.made < 0.0 {
            fail(format!("holds {} and made {}, below zero", js_number(s.left), js_number(s.made)));
        }
        if (s.left + s.made - s.first).abs() > 1e-6 {
            let m = format!(
                "made {} and holds {}, not the {} it came into being with",
                js_number(s.made),
                js_number(s.left),
                js_number(s.first)
            );
            fail(m);
        }
        if s.left < 1.0 {
            fail("has nothing left but is still there".into());
        }
    }
    for d in &world.dry_nodes {
        if world.nodes.iter().any(|n| n.id == d.id) {
            out.push(violation(
                name,
                format!("node {} ran dry but is still there", d.id),
                &[&d.id],
            ));
        }
    }
    out
}

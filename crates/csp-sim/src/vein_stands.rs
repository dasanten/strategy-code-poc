//! How the vein stands (`CONTEXT.md`: Running dry; Epic 102): whoever works a node's workplace,
//! their realm and its allies, sees how its vein stands in words (plenty, thinning, nearly gone,
//! or that it never runs dry), never as a number; everyone else sees nothing of it. The log of
//! each realm working it says once when it turns to thinning and once at nearly gone.

use csp_shared::world::{
    Building, RealmEventWhat, Resident, ResidentOrder, ScriptParamValue, VeinStock, VeinWord,
    WorldState,
};
use indexmap::IndexMap;

use crate::default_scripts::WORKPLACE_PARAM;
use crate::events::record_event;
use crate::queries::alliance::{allied, allied_realms};
use crate::queries::building::{max_workers, workplace_node};

/// The memory key the Work default keeps the workplace it started on in, when none is picked.
const WORKPLACE_MEMORY: &str = "workplaceId";

/// The workplace a resident works, or is away from while working it (carrying its output,
/// fetching Food, on their way): the one their work-at order names, else the `workplace` param of
/// the script they run, else the one their Work default started on.
pub fn workplace_worked(r: &Resident) -> Option<&str> {
    if let Some(ResidentOrder::WorkAt(o)) = &r.order {
        return Some(&o.building_id);
    }
    let script = r.script.as_ref()?;
    let picked =
        r.script_params.as_ref().and_then(|p| p.get(&script.script_id)?.get(WORKPLACE_PARAM));
    if let Some(ScriptParamValue::Id(id)) = picked {
        return Some(id);
    }
    script.memory.get(WORKPLACE_MEMORY)?.as_str()
}

/// The realms with a resident working `workplace` (`workplace_worked`), in the world's order.
pub fn realms_working(world: &WorldState, workplace: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for r in &world.residents {
        let Some(owner) = &r.owner else { continue };
        if workplace_worked(r) == Some(workplace) && !out.contains(owner) {
            out.push(owner.clone());
        }
    }
    out
}

/// How the vein under a finished workplace on a node stands: the word of its stock, or `Endless`
/// for a node that never runs dry. None for any other building, a construction site, and a mine
/// whose vein ran dry.
pub fn vein_word(world: &WorldState, b: &Building) -> Option<VeinWord> {
    if b.site.is_some() {
        return None;
    }
    max_workers(b.kind)?;
    let node = workplace_node(world, b)?;
    Some(node.stock.as_ref().map_or(VeinWord::Endless, VeinStock::word))
}

/// How the vein under `b` stands as the realm `realm` sees it: only while it or an ally works it
/// (`CONTEXT.md`: Running dry).
pub fn vein_seen_by(world: &WorldState, b: &Building, realm: &str) -> Option<VeinWord> {
    let word = vein_word(world, b)?;
    realms_working(world, &b.id).iter().any(|w| allied(world, realm, w)).then_some(word)
}

/// The veins the realm `realm` sees, by workplace id: those of every workplace on a node it or an
/// ally works, in the order their workers are found.
pub fn veins_seen_by(world: &WorldState, realm: &str) -> IndexMap<String, VeinWord> {
    let realms = allied_realms(world, realm);
    let mut out = IndexMap::new();
    for r in &world.residents {
        if !r.owner.as_ref().is_some_and(|o| realms.contains(o)) {
            continue;
        }
        let Some(id) = workplace_worked(r) else { continue };
        if out.contains_key(id) {
            continue;
        }
        let Some(b) = world.buildings.iter().find(|b| b.id == id) else { continue };
        if let Some(word) = vein_word(world, b) {
            out.insert(id.to_string(), word);
        }
    }
    out
}

/// Tells each realm working `workplace` when the unit just taken from its vein turned it to
/// thinning or to nearly gone (`CONTEXT.md`: Running dry): `before` is the stock as it was.
pub fn tell_vein_turned(world: &mut WorldState, workplace: &Building, before: VeinStock) {
    let Some(node) = workplace_node(world, workplace) else { return };
    let Some(after) = node.stock else { return };
    let vein = after.word();
    if vein == before.word() || !matches!(vein, VeinWord::Thinning | VeinWord::NearlyGone) {
        return;
    }
    let (kind, x, y) = (node.kind, node.x, node.y);
    for realm in realms_working(world, &workplace.id) {
        record_event(
            world,
            Some(&realm),
            RealmEventWhat::VeinTurned {
                building_id: workplace.id.clone(),
                node: kind,
                x,
                y,
                vein,
            },
        );
    }
}

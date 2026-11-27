//! NPC cities founding new ones: the party, its load, the site and the founding wave.

use crate::invariants::{invariant, Invariant};

pub const INVARIANTS: &[Invariant] = &[
    invariant("founding-parties-sound", |w, _t| crate::npc_founding::founding_parties_sound(w)),
    invariant("full-wait-sound", |w, _t| crate::npc_founding::full_wait_sound(w)),
    invariant("founding-site-clear", |w, t| crate::npc_founding::founding_site_clear(w, t.size)),
    invariant("founding-party-sets-out-loaded", |w, t| {
        crate::npc_founding::founding_party_sets_out_loaded(w, t.size)
    }),
    invariant("founding-wave-sound", |w, _t| crate::npc_founding::founding_wave_sound(w)),
    invariant("mother-fetch-sound", |w, _t| crate::npc_founding::mother_fetch_sound(w)),
    invariant("npc-founding-stone-kept", |w, _t| crate::npc_plan::npc_founding_stone_kept(w)),
    invariant("npc-founding-materials-kept", |w, _t| {
        crate::npc_plan::npc_founding_materials_kept(w)
    }),
];

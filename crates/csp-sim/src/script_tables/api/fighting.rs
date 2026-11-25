//! Fighting, feeding, equipping and climbing.

use crate::script_api::{Is, ScriptBinding};
use crate::script_views::ScriptType;

pub(super) const FIGHTING: &[ScriptBinding] = &[
    ScriptBinding {
        name: "attack",
        is: Is::Action,
        params: &["targetId"],
        cost: 10.0,
        description: "Go after a resident I see and strike them, or strike a wall or gate of another realm until it falls. With a Bow or Crossbow and Arrows I walk only until they are in my `reach` and shoot from there.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "shoot",
        is: Is::Action,
        params: &["targetId"],
        cost: 10.0,
        description: "Shoot a resident I see who is in my `reach` now, with my Bow or Crossbow and an Arrow a shot, without a step. The order goes on as an attack: should they get out of reach I go after them, so `stop()` to stay where I am.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "feed",
        is: Is::Action,
        params: &["targetId", "units"],
        cost: 10.0,
        description: "Feed a resident who is Down or a horse that isn’t full, of any realm, on or next to my tile, with up to that many units of the Food in my hands. A resident gets it in their hands, eats at once and wakes at low health. A horse eats until it is full, and wakes if it was Down; the rest stays with me.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "equip",
        is: Is::Action,
        params: &["good"],
        cost: 10.0,
        description: "Swap a weapon, shield or armour I carry, like \"sword\", into the slot it fits; what was there stays carried. It takes a few ticks, and I strike no blows meanwhile.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "takeOff",
        is: Is::Action,
        params: &["slot"],
        cost: 10.0,
        description: "Take off what I have in a slot, \"weapon\", \"shield\" or \"armour\"; it stays carried, and the slot stays empty until I pick up more that fits it. It takes a few ticks, and I strike no blows meanwhile.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "climb",
        is: Is::Action,
        params: &["wallId"],
        cost: 10.0,
        description: "Climb over the wall or gate of another realm next to me.",
        returns: ScriptType::String,
    },
];

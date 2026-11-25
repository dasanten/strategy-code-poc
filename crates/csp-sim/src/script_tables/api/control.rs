//! What a script does with itself that asks for no order: end, wait, say what it is doing, log.

use crate::script_api::{Is, ScriptBinding};
use crate::script_views::ScriptType;

pub(super) const CONTROL: &[ScriptBinding] = &[
    ScriptBinding {
        name: "end",
        is: Is::Action,
        params: &["reason?"],
        cost: 10.0,
        description: "End this script: once this run is over I stand idle and run it no more, and in a queue its next step starts. With `reason`, short text (cut to 60 characters), my Player’s realm log says why, like “Ana stopped Work: no workplace on her tile”. It asks for no order.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "wait",
        is: Is::Action,
        params: &[],
        cost: 10.0,
        description: "Wait on my order: once this run is over I am not run again until it ends, is replaced or I am struck; then I run every tick again. With no order, it does nothing. It asks for no order.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "doing",
        is: Is::Action,
        params: &["text"],
        cost: 10.0,
        description: "Say what I’m doing, for my Player’s Doing line: the text (cut to 60 characters) shows instead of the one the game derives from my task and order, until I call it again; null gives the derived one back. Kept as `memory.doing`; it asks for no order.",
        returns: ScriptType::String,
    },
    ScriptBinding {
        name: "log",
        is: Is::Action,
        params: &["text"],
        cost: 10.0,
        description: "Add a line to my script log, with the game time: short text (cut to 60 characters) that my Player sees on my Script tab, and nobody else. I keep my last 20 lines across scripts; `end(reason)` adds its reason too. It asks for no order.",
        returns: ScriptType::String,
    },
];

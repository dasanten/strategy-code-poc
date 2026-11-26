//! What an order says about the actions a resident's script asks for it with (T121.7): each
//! [`ScriptAction`] stands in the module of its order, which names it in its `OrderMeta`
//! (`order_meta`). The game API's entries (`script_tables::SCRIPT_API`) are made from them, and
//! so is the request of every action whose arguments are simply the order's fields
//! ([`Request::Fields`]); the others are bound by hand (`script_bindings::irregular`).

use std::collections::HashMap;
use std::sync::LazyLock;

use crate::order_meta::ORDER_METAS;
use crate::script_api::{Is, ScriptBinding};
use crate::script_views::ScriptType;

/// Where the game API lists an action: the groups one after the other, each with the actions of
/// its orders as `ORDER_METAS` orders them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActionGroup {
    /// Walking, driving, riding, boarding and hauling.
    Movement,
    /// What a script does with itself; also those that ask for no order.
    Control,
    /// Goods, building, gathering, work, teaching and breeding.
    Work,
    /// Fighting, feeding, equipping and climbing.
    Fighting,
    /// Contracts, the market, offers and paying.
    Trade,
    /// Leading the realm: its names, its city, demands, lines and waypoints.
    Ruling,
}

/// How an argument becomes a field of the request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Given {
    /// As plain data; left out when null or not given.
    Plain,
    /// The id of the thing given, or the id itself; null when null or not given.
    Place,
    /// The same, but left out when null or not given.
    PlaceIfAny,
}

/// One argument of an action, and the field of the order request it is.
#[derive(Debug, Clone, Copy)]
pub struct ScriptArg {
    /// As the game API names it; a `?` marks one that may be left out.
    pub name: &'static str,
    pub field: &'static str,
    pub given: Given,
}

/// An argument that is the field of its name, as plain data.
pub const fn arg(name: &'static str) -> ScriptArg {
    arg_as(name, name)
}

/// An argument that is the field `field`, as plain data.
pub const fn arg_as(name: &'static str, field: &'static str) -> ScriptArg {
    ScriptArg { name, field, given: Given::Plain }
}

/// An argument that is a thing or its id.
pub const fn place(name: &'static str, field: &'static str) -> ScriptArg {
    ScriptArg { name, field, given: Given::Place }
}

/// An argument that is a thing or its id, if given.
pub const fn place_if_any(name: &'static str, field: &'static str) -> ScriptArg {
    ScriptArg { name, field, given: Given::PlaceIfAny }
}

/// How an action's arguments make the order request.
#[derive(Debug, Clone, Copy)]
pub enum Request {
    /// Each argument is a field of it.
    Fields(&'static [ScriptArg]),
    /// By hand, in `script_bindings::irregular`; the arguments by name.
    ByHand(&'static [&'static str]),
}

/// An action of a resident's script that asks for an order.
#[derive(Debug, Clone, Copy)]
pub struct ScriptAction {
    pub name: &'static str,
    pub group: ActionGroup,
    pub request: Request,
    pub cost: f64,
    pub description: &'static str,
    pub returns: ScriptType,
}

impl ScriptAction {
    /// The action's entry in the game API.
    fn binding(&self) -> ScriptBinding {
        ScriptBinding {
            name: self.name,
            is: Is::Action,
            params: match self.request {
                // Made once, for the game API's table.
                Request::Fields(args) => {
                    Box::leak(args.iter().map(|a| a.name).collect::<Box<[_]>>())
                }
                Request::ByHand(params) => params,
            },
            cost: self.cost,
            description: self.description,
            returns: self.returns,
        }
    }
}

/// The actions that ask for an order, each with the order's kind.
pub fn script_actions() -> impl Iterator<Item = (&'static str, &'static ScriptAction)> {
    ORDER_METAS.iter().flat_map(|m| m.script.iter().map(|a| (m.kind, a)))
}

/// The action named `name` and the kind of the order it asks for, if it asks for one.
pub fn script_action(name: &str) -> Option<(&'static str, &'static ScriptAction)> {
    static BY_NAME: LazyLock<HashMap<&'static str, (&'static str, &'static ScriptAction)>> =
        LazyLock::new(|| script_actions().map(|(kind, a)| (a.name, (kind, a))).collect());
    BY_NAME.get(name).copied()
}

/// The game API's entries of a group's actions.
pub(crate) fn group_bindings(group: ActionGroup) -> impl Iterator<Item = ScriptBinding> {
    script_actions().filter(move |(_, a)| a.group == group).map(|(_, a)| a.binding())
}

#[cfg(test)]
mod tests;

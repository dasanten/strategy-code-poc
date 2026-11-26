//! The game API of a resident's script (ADR 0002): the values, the queries, the actions that ask
//! for an order, made from the orders (`script_actions`), and those that ask for none.

mod control;
mod queries;
mod values;

use std::sync::LazyLock;

use self::control::CONTROL;
use crate::script_actions::{group_bindings, ActionGroup};
use crate::script_api::ScriptBinding;

/// The game API of a resident's script (`SCRIPT_API`).
pub static SCRIPT_API: LazyLock<Vec<ScriptBinding>> = LazyLock::new(|| {
    let mut api = [values::VALUES, queries::QUERIES].concat();
    api.extend(group_bindings(ActionGroup::Movement));
    api.extend(group_bindings(ActionGroup::Control));
    api.extend_from_slice(CONTROL);
    api.extend(group_bindings(ActionGroup::Work));
    api.extend(group_bindings(ActionGroup::Fighting));
    api.extend(group_bindings(ActionGroup::Trade));
    api.extend(group_bindings(ActionGroup::Ruling));
    api
});

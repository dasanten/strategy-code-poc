//! The actions of a resident's script bound by hand. Every other action is made from its order's
//! `ScriptAction` (`script_actions`); one is here only when its arguments aren't simply the
//! order's fields, with its reason in [`IRREGULAR_ACTIONS`] or [`OWN_ACTIONS`].

use csp_lang::interpreter::CallError;
use csp_lang::Value;
use csp_shared::balance::HAUL_KEEP_FOOD;
use serde_json::{json, Map, Value as Json};

use super::{doing_text, host_error, place_or_null, plain, short_text, ScriptBindings};
use crate::queries::building::building_at;

/// The actions that ask for an order ([`Request::ByHand`](crate::script_actions::Request)), and
/// why each isn't regular.
#[cfg(test)]
pub(crate) const IRREGULAR_ACTIONS: &[(&str, &str)] = &[
    ("haul", "returnGoods and keepFood left out are an empty list and HAUL_KEEP_FOOD"),
    ("loadShip", "asks for `load` with `unload` false"),
    ("unloadShip", "asks for `load` with `unload` true"),
    ("shoot", "asks for `attack` with `shoot` true"),
    ("throw", "its second argument is a wall, or x when a third is given"),
    ("teach", "the building is the one on my tile"),
    ("train", "the building is the one on my tile"),
    ("roadLine", "from my tile, and x and y are one field"),
    ("wallLine", "from my tile, and x and y are one field"),
    ("addWaypoint", "checked against the waypoints the run already added"),
    ("removeWaypoint", "checked against the waypoints the run already removed"),
];

/// The actions that ask for no order (`script_tables`' control), and what each does instead.
#[cfg(test)]
pub(crate) const OWN_ACTIONS: &[(&str, &str)] = &[
    ("doing", "writes `memory.doing`"),
    ("end", "ends the script"),
    ("wait", "holds the script until the order ends"),
    ("log", "adds a line to the script log"),
];

impl ScriptBindings<'_> {
    /// The actions of [`IRREGULAR_ACTIONS`]; `kind` is the order the action asks for.
    pub(super) fn irregular_action(
        &mut self,
        name: &str,
        kind: &'static str,
        args: &[Value],
    ) -> Result<Value, CallError> {
        let r = self.me();
        let given = |i: usize| args.get(i).filter(|v| !v.is_null());
        let p = |i: usize| plain(args.get(i));
        let place = |i: usize| place_or_null(args.get(i));
        let here = || {
            building_at(self.world(), r.x as i32, r.y as i32, self.size())
                .map(|b| json!(b.id))
                .or(Some(Json::Null))
        };
        let input = match name {
            "haul" => {
                let returns = plain(Some(given(4).unwrap_or(&Value::list(vec![]))))?;
                let keep = plain(Some(given(5).unwrap_or(&Value::Number(HAUL_KEEP_FOOD))))?;
                vec![
                    ("carriageId", p(0)?),
                    ("x", p(1)?),
                    ("y", p(2)?),
                    ("goods", p(3)?),
                    ("returnGoods", returns),
                    ("keepFood", keep),
                ]
            }
            "loadShip" | "unloadShip" => {
                let unload = Some(Json::Bool(name == "unloadShip"));
                vec![("vesselId", place(0)?), ("goods", p(1)?), ("unload", unload)]
            }
            "shoot" => vec![("targetId", p(0)?), ("shoot", Some(Json::Bool(true)))],
            "throw" => {
                let at = if given(2).is_some() {
                    vec![("x", p(1)?), ("y", p(2)?)]
                } else {
                    vec![("targetId", place(1)?)]
                };
                let mut input = vec![("machineId", place(0)?)];
                input.extend(at);
                input
            }
            "teach" => vec![("buildingId", here()), ("subject", p(0)?)],
            "train" => vec![("buildingId", here())],
            "roadLine" | "wallLine" => {
                let from = json!({ "x": r.x, "y": r.y });
                let mut to = Map::new();
                if let Some(x) = p(0)? {
                    to.insert("x".into(), x);
                }
                if let Some(y) = p(1)? {
                    to.insert("y".into(), y);
                }
                let mut input = vec![("from", Some(from)), ("to", Some(Json::Object(to)))];
                if name == "wallLine" {
                    input.push(("material", p(2)?));
                }
                input
            }
            "addWaypoint" | "removeWaypoint" => return self.waypoint_action(name, args),
            _ => return Err(host_error(format!("the script action {name} is not bound by hand"))),
        };
        self.request(kind, input)
    }

    /// The actions of [`OWN_ACTIONS`].
    pub(super) fn own_action(&mut self, name: &str, args: &[Value]) -> Result<Value, CallError> {
        match name {
            "doing" => {
                let doing = doing_text(args.first())?;
                let mut memory = self.ctx.memory.borrow_mut();
                match doing {
                    None => {
                        memory.remove("doing");
                    }
                    Some(text) => memory.insert("doing", Value::string(&text)),
                }
                Ok(Value::Null)
            }
            "end" => {
                self.end_reason = short_text(args.first(), "end")?;
                self.ended = true;
                Ok(Value::Null)
            }
            "wait" => {
                self.waited = true;
                Ok(Value::Null)
            }
            "log" => {
                if let Some(line) = short_text(args.first(), "log")? {
                    self.logged.push(line);
                }
                Ok(Value::Null)
            }
            _ => Err(host_error(format!("the script binding {name} is not implemented"))),
        }
    }
}

//! A ready-made [`Host`]: globals in a map and native functions as closures. The tests bind their
//! fake game with it; the game API (Epic 86) implements [`Host`] itself.

use std::collections::HashMap;

use crate::interpreter::{CallError, Host};
use crate::value::{NativeFunction, Value};

type Native = Box<dyn FnMut(&[Value]) -> Result<Value, CallError>>;

/// Globals by name, with native functions as closures.
#[derive(Default)]
pub struct Globals {
    values: HashMap<String, Value>,
    natives: Vec<Native>,
}

impl Globals {
    pub fn new() -> Self {
        Globals::default()
    }

    /// Gives the script a global `name` holding `value`.
    pub fn set(&mut self, name: &str, value: Value) -> &mut Self {
        self.values.insert(name.to_string(), value);
        self
    }

    /// Gives the script a native function `name` that costs `cost` extra steps a call.
    pub fn function(
        &mut self,
        name: &str,
        cost: u64,
        call: impl FnMut(&[Value]) -> Result<Value, CallError> + 'static,
    ) -> &mut Self {
        let id = self.natives.len() as u32;
        self.natives.push(Box::new(call));
        self.set(name, Value::native(name, id, cost))
    }

    pub fn get(&self, name: &str) -> Option<&Value> {
        self.values.get(name)
    }

    /// The names of the globals, in no order.
    pub fn names(&self) -> impl Iterator<Item = &str> {
        self.values.keys().map(String::as_str)
    }
}

impl Host for Globals {
    fn global(&mut self, name: &str) -> Option<Value> {
        self.values.get(name).cloned()
    }

    fn call(&mut self, function: &NativeFunction, args: Vec<Value>) -> Result<Value, CallError> {
        let native =
            self.natives.get_mut(function.id as usize).expect("a native function of this host");
        native(&args)
    }
}

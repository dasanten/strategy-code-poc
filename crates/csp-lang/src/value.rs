//! The values a script works with: the twin of `Value` in `packages/lang/src/interpreter.ts`.
//!
//! `null`, booleans, numbers (`f64`), strings, lists, objects and functions. Lists and objects are
//! shared by reference, as JavaScript arrays and objects are: `==` on them is identity, and a
//! change through one name shows through every other. A host value may be frozen (read-only to
//! the script), as the TypeScript host froze its views with `Object.freeze`.

use std::borrow::Cow;
use std::cell::{Ref, RefCell, RefMut};
use std::fmt;
use std::rc::Rc;

use indexmap::IndexMap;

use crate::js;

/// A value a script works with.
#[derive(Clone)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    String(Rc<str>),
    List(List),
    Object(Object),
    /// A function written in the script, valid in the run that made it.
    Function(ScriptFunction),
    /// A function the host gives the script, such as a game API action or query.
    Native(Rc<NativeFunction>),
}

/// A list, shared by reference.
#[derive(Clone)]
pub struct List(Rc<RefCell<ListData>>);

#[derive(Debug, Default)]
pub struct ListData {
    pub items: Vec<Value>,
    /// Read-only to the script (`Object.freeze` in the TypeScript).
    pub frozen: bool,
}

/// An object, shared by reference. Its keys keep JavaScript's order: array-index keys (`"0"`,
/// `"12"`) first in numeric order, then the others in the order they were added.
#[derive(Clone)]
pub struct Object(Rc<RefCell<ObjectData>>);

#[derive(Debug, Default)]
pub struct ObjectData {
    /// A host view's keys are its static field names, held without a copy (#1092). Hashed with
    /// `FxHash`, which leaves their order as it is and costs a fraction of SipHash (T89.6).
    entries: IndexMap<Cow<'static, str>, Value, rustc_hash::FxBuildHasher>,
    /// Read-only to the script (`Object.freeze` in the TypeScript).
    pub frozen: bool,
}

/// A function the host gives the script. The host tells its functions apart by `id`; a call
/// costs `cost` steps on top of the 1 every evaluated node costs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeFunction {
    pub name: String,
    pub id: u32,
    /// Extra steps one call costs, on top of the 1 every evaluated node costs.
    pub cost: u64,
}

/// A function written in the script: an index into the run's functions, tagged with the run.
#[derive(Clone)]
pub struct ScriptFunction(pub(crate) Rc<FunctionHandle>);

pub(crate) struct FunctionHandle {
    /// The run that made it; a function is called only in the run that made it.
    pub(crate) run: Rc<()>,
    pub(crate) index: usize,
    /// Its name, or `""` for a `fn (…) { … }` value.
    pub(crate) name: String,
}

impl ScriptFunction {
    /// The function's name, or `""` for a `fn (…) { … }` value.
    pub fn name(&self) -> &str {
        &self.0.name
    }
}

impl ListData {
    pub fn new(items: Vec<Value>) -> Self {
        ListData { items, frozen: false }
    }
}

impl ObjectData {
    /// The value at `key`.
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.entries.get(key)
    }

    pub fn contains_key(&self, key: &str) -> bool {
        self.entries.contains_key(key)
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// The entries in JavaScript's key order.
    pub fn iter(&self) -> impl Iterator<Item = (&str, &Value)> {
        self.entries.iter().map(|(k, v)| (k.as_ref(), v))
    }

    /// Deletes `key` (`delete object[key]`), keeping the others' order; what it held, if any.
    pub fn remove(&mut self, key: &str) -> Option<Value> {
        self.entries.shift_remove(key)
    }

    /// Sets `key`, keeping its place if it is there and JavaScript's key order if it is new.
    pub fn insert(&mut self, key: impl Into<String>, value: Value) {
        let key: String = key.into();
        if let Some(slot) = self.entries.get_mut(key.as_str()) {
            *slot = value;
            return;
        }
        match js::array_index(&key) {
            None => {
                self.entries.insert(Cow::Owned(key), value);
            }
            Some(index) => {
                let at = self
                    .entries
                    .keys()
                    .position(|k| js::array_index(k).is_none_or(|other| other > index))
                    .unwrap_or(self.entries.len());
                self.entries.shift_insert(at, Cow::Owned(key), value);
            }
        }
    }
}

impl List {
    pub fn new(items: Vec<Value>) -> Self {
        List(Rc::new(RefCell::new(ListData::new(items))))
    }

    pub fn borrow(&self) -> Ref<'_, ListData> {
        self.0.borrow()
    }

    pub fn borrow_mut(&self) -> RefMut<'_, ListData> {
        self.0.borrow_mut()
    }

    pub fn ptr_eq(&self, other: &List) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }

    pub(crate) fn addr(&self) -> usize {
        Rc::as_ptr(&self.0) as *const u8 as usize
    }
}

impl Object {
    pub fn new() -> Self {
        Object(Rc::new(RefCell::new(ObjectData::default())))
    }

    pub fn borrow(&self) -> Ref<'_, ObjectData> {
        self.0.borrow()
    }

    pub fn borrow_mut(&self) -> RefMut<'_, ObjectData> {
        self.0.borrow_mut()
    }

    pub fn ptr_eq(&self, other: &Object) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }

    pub(crate) fn addr(&self) -> usize {
        Rc::as_ptr(&self.0) as *const u8 as usize
    }
}

impl Default for Object {
    fn default() -> Self {
        Object::new()
    }
}

impl Value {
    pub fn string(s: &str) -> Value {
        Value::String(Rc::from(s))
    }

    pub fn list(items: Vec<Value>) -> Value {
        Value::List(List::new(items))
    }

    /// An object with these entries, set in this order.
    pub fn object<K: Into<String>>(entries: impl IntoIterator<Item = (K, Value)>) -> Value {
        let object = Object::new();
        {
            let mut data = object.borrow_mut();
            for (key, value) in entries {
                data.insert(key, value);
            }
        }
        Value::Object(object)
    }

    /// A frozen object of a host view's fields, set in this order: what
    /// `Value::object(fields).freeze()` gives for fields whose values are frozen already, built
    /// without checking each key. The keys are the view's own field names: distinct, and none an
    /// array index, so their order is the order given.
    pub fn frozen_fields(fields: impl ExactSizeIterator<Item = (&'static str, Value)>) -> Value {
        let mut entries = IndexMap::with_capacity_and_hasher(fields.len(), Default::default());
        for (key, value) in fields {
            debug_assert!(js::array_index(key).is_none(), "a field name is no array index");
            let old = entries.insert(Cow::Borrowed(key), value);
            debug_assert!(old.is_none(), "field {key} twice");
        }
        Value::Object(Object(Rc::new(RefCell::new(ObjectData { entries, frozen: true }))))
    }

    /// A frozen list of values that are frozen already: `Value::list(items).freeze()`.
    pub fn frozen_list(items: Vec<Value>) -> Value {
        Value::List(List(Rc::new(RefCell::new(ListData { items, frozen: true }))))
    }

    pub fn native(name: &str, id: u32, cost: u64) -> Value {
        Value::Native(Rc::new(NativeFunction { name: name.to_string(), id, cost }))
    }

    /// Makes this list or object, and every list and object in it, read-only to the script.
    pub fn freeze(self) -> Value {
        // Marked before its items, so a value that holds itself is frozen once.
        match &self {
            Value::List(list) if !list.borrow().frozen => {
                list.borrow_mut().frozen = true;
                let items = list.borrow().items.clone();
                items.into_iter().for_each(|item| drop(item.freeze()));
            }
            Value::Object(object) if !object.borrow().frozen => {
                object.borrow_mut().frozen = true;
                let items: Vec<Value> = object.borrow().iter().map(|(_, v)| v.clone()).collect();
                items.into_iter().for_each(|item| drop(item.freeze()));
            }
            _ => {}
        }
        self
    }

    /// JSON as a script value: numbers as `f64`, objects with their keys in JavaScript's order.
    pub fn from_json(json: &serde_json::Value) -> Value {
        match json {
            serde_json::Value::Null => Value::Null,
            serde_json::Value::Bool(b) => Value::Bool(*b),
            serde_json::Value::Number(n) => Value::Number(n.as_f64().unwrap_or(f64::NAN)),
            serde_json::Value::String(s) => Value::string(s),
            serde_json::Value::Array(items) => {
                Value::list(items.iter().map(Value::from_json).collect())
            }
            serde_json::Value::Object(map) => {
                Value::object(map.iter().map(|(k, v)| (k.clone(), Value::from_json(v))))
            }
        }
    }

    pub fn as_number(&self) -> Option<f64> {
        match self {
            Value::Number(n) => Some(*n),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::String(s) => Some(s),
            _ => None,
        }
    }

    pub fn is_null(&self) -> bool {
        matches!(self, Value::Null)
    }

    /// The script's `==`: JavaScript's `===`. By value for null, booleans, numbers and strings;
    /// by identity for lists, objects and functions.
    pub fn strict_equals(&self, other: &Value) -> bool {
        match (self, other) {
            (Value::Null, Value::Null) => true,
            (Value::Bool(a), Value::Bool(b)) => a == b,
            (Value::Number(a), Value::Number(b)) => a == b,
            (Value::String(a), Value::String(b)) => a == b,
            (Value::List(a), Value::List(b)) => a.ptr_eq(b),
            (Value::Object(a), Value::Object(b)) => a.ptr_eq(b),
            (Value::Function(a), Value::Function(b)) => Rc::ptr_eq(&a.0, &b.0),
            (Value::Native(a), Value::Native(b)) => Rc::ptr_eq(a, b),
            _ => false,
        }
    }

    /// Whether two values hold the same data, as `toEqual` in the TypeScript tests compares:
    /// lists and objects item by item (object keys in any order), functions by identity.
    pub fn deep_equals(&self, other: &Value) -> bool {
        match (self, other) {
            (Value::Number(a), Value::Number(b)) => a == b || (a.is_nan() && b.is_nan()),
            (Value::List(a), Value::List(b)) => {
                if a.ptr_eq(b) {
                    return true;
                }
                let (a, b) = (a.borrow(), b.borrow());
                a.items.len() == b.items.len()
                    && a.items.iter().zip(&b.items).all(|(x, y)| x.deep_equals(y))
            }
            (Value::Object(a), Value::Object(b)) => {
                if a.ptr_eq(b) {
                    return true;
                }
                let (a, b) = (a.borrow(), b.borrow());
                a.len() == b.len()
                    && a.iter().all(|(k, x)| b.get(k).is_some_and(|y| x.deep_equals(y)))
            }
            _ => self.strict_equals(other),
        }
    }
}

/// `false`, `null`, `0` and `""` count as false; everything else as true.
pub fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => *n != 0.0,
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

impl fmt::Debug for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Null => write!(f, "null"),
            Value::Bool(b) => write!(f, "{b}"),
            Value::Number(n) => write!(f, "{}", js::number_to_string(*n)),
            Value::String(s) => write!(f, "{}", js::json_string(s)),
            Value::List(list) => match list.0.try_borrow() {
                Ok(data) => f.debug_list().entries(data.items.iter()).finish(),
                Err(_) => write!(f, "[…]"),
            },
            Value::Object(object) => match object.0.try_borrow() {
                Ok(data) => f.debug_map().entries(data.iter()).finish(),
                Err(_) => write!(f, "{{…}}"),
            },
            Value::Function(_) => write!(f, "fn"),
            Value::Native(n) => write!(f, "native {}", n.name),
        }
    }
}

impl From<f64> for Value {
    fn from(n: f64) -> Self {
        Value::Number(n)
    }
}

impl From<bool> for Value {
    fn from(b: bool) -> Self {
        Value::Bool(b)
    }
}

impl From<&str> for Value {
    fn from(s: &str) -> Self {
        Value::string(s)
    }
}

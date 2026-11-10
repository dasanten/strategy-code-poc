//! A static check over a parsed script: names that are declared nowhere, calls with the wrong
//! number of arguments, and fields an object of a known shape doesn't have. The twin of
//! `packages/lang/src/checker.ts`. Its findings are warnings, never errors: wherever it isn't
//! sure, it stays quiet. It knows nothing of the game: the names a script gets and the shapes of
//! their values are passed in.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::ast::*;
use crate::js;
use crate::Diagnostic;

/// What the checker knows of a value: nothing, a list of something, or an object of a shape.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CheckedType {
    Unknown,
    List(Box<CheckedType>),
    Shape(String),
}

impl CheckedType {
    pub fn list(item: CheckedType) -> Self {
        CheckedType::List(Box::new(item))
    }

    pub fn shape(name: impl Into<String>) -> Self {
        CheckedType::Shape(name.into())
    }
}

/// A name every script gets: a value of a type, or a function with parameters and a result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckedGlobal {
    /// The value's type, or what the function answers.
    pub ty: CheckedType,
    /// For a function: its parameters, a `?` marking one that may be left out.
    pub params: Option<Vec<String>>,
}

impl CheckedGlobal {
    pub fn value(ty: CheckedType) -> Self {
        CheckedGlobal { ty, params: None }
    }

    pub fn function(ty: CheckedType, params: &[&str]) -> Self {
        CheckedGlobal { ty, params: Some(params.iter().map(|p| p.to_string()).collect()) }
    }
}

/// The fields of one object shape, with the type each holds.
pub type ShapeFields = HashMap<String, CheckedType>;

/// The names and shapes a script gets.
#[derive(Default)]
pub struct CheckEnv {
    pub globals: HashMap<String, CheckedGlobal>,
    /// The fields of each object shape by name.
    pub shapes: HashMap<String, ShapeFields>,
    /// How a shape is named in a warning, like "a resident"; `a <name>` without it.
    #[allow(clippy::type_complexity)]
    pub describe_shape: Option<Box<dyn Fn(&str) -> String>>,
    /// What `params.name` holds for a `param` of each type; unknown without it.
    pub param_types: HashMap<ParamType, CheckedType>,
}

/// The shape of `params`: the script's own `param` lines.
pub const PARAMS_SHAPE: &str = "$params";

/// A field read from an object whose shape the checker was sure of.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FieldRead {
    pub shape: String,
    pub field: String,
    /// Whether the shape has the field.
    pub declared: bool,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct CheckResult {
    pub warnings: Vec<Diagnostic>,
    pub reads: Vec<FieldRead>,
}

/// What the TypeScript checker held for a name. Besides the types it also held JavaScript's
/// `undefined`, the "type" of a name found on `Object.prototype` (see `Global::Prototype`), and
/// carried it through `let`. `None` is that `undefined`.
type Ty = Option<CheckedType>;

const UNKNOWN: Ty = Some(CheckedType::Unknown);

/// A global as the TypeScript found it with `globals[name]` on a plain object.
enum Global<'e> {
    Declared(&'e CheckedGlobal),
    /// A name every JavaScript object has (`toString`, `constructor`, …): found, with no
    /// `params` and an `undefined` type. Ported as it is (see the PR of T85.2).
    Prototype,
}

struct Scope {
    names: HashMap<String, Ty>,
}

struct Checker<'e> {
    env: &'e CheckEnv,
    params: &'e ShapeFields,
    params_global: CheckedGlobal,
    warnings: Vec<Diagnostic>,
    reads: Vec<FieldRead>,
    reassigned: HashSet<String>,
    scopes: Vec<Scope>,
}

/// Every name assigned to with `name = …` anywhere: what they hold isn't certain.
fn reassigned_names(program: &Program) -> HashSet<String> {
    let mut out = HashSet::new();
    for s in &program.body {
        visit_statement(s, &mut out);
    }
    out
}

fn visit_block(block: &BlockStatement, out: &mut HashSet<String>) {
    for s in &block.body {
        visit_statement(s, out);
    }
}

fn visit_statement(s: &Statement, out: &mut HashSet<String>) {
    match s {
        Statement::Let(s) => {
            if let Some(init) = &s.init {
                visit_expression(init, out);
            }
        }
        Statement::If(s) => visit_if(s, out),
        Statement::While(s) => {
            visit_expression(&s.test, out);
            visit_block(&s.body, out);
        }
        Statement::ForOf(s) => {
            visit_expression(&s.list, out);
            visit_block(&s.body, out);
        }
        Statement::FunctionDeclaration(s) => visit_block(&s.body, out),
        Statement::Return(s) => {
            if let Some(value) = &s.value {
                visit_expression(value, out);
            }
        }
        Statement::Block(s) => visit_block(s, out),
        Statement::ExpressionStatement(s) => visit_expression(&s.expression, out),
    }
}

fn visit_if(s: &IfStatement, out: &mut HashSet<String>) {
    visit_expression(&s.test, out);
    visit_block(&s.then, out);
    match s.otherwise.as_deref() {
        Some(Else::Block(b)) => visit_block(b, out),
        Some(Else::If(i)) => visit_if(i, out),
        None => {}
    }
}

fn visit_expression(e: &Expression, out: &mut HashSet<String>) {
    match e {
        Expression::Number(_)
        | Expression::String(_)
        | Expression::Boolean(_)
        | Expression::Null(_)
        | Expression::Identifier(_) => {}
        Expression::List(e) => e.items.iter().for_each(|i| visit_expression(i, out)),
        Expression::Object(e) => e.properties.iter().for_each(|p| visit_expression(&p.value, out)),
        Expression::Function(e) => visit_block(&e.body, out),
        Expression::Unary(e) => visit_expression(&e.operand, out),
        Expression::Binary(e) => {
            visit_expression(&e.left, out);
            visit_expression(&e.right, out);
        }
        Expression::Logical(e) => {
            visit_expression(&e.left, out);
            visit_expression(&e.right, out);
        }
        Expression::Assign(e) => {
            match e.target.as_ref() {
                AssignTarget::Identifier(id) => {
                    out.insert(id.name.clone());
                }
                AssignTarget::Member(m) => visit_expression(&m.object, out),
                AssignTarget::Index(i) => {
                    visit_expression(&i.object, out);
                    visit_expression(&i.index, out);
                }
            }
            visit_expression(&e.value, out);
        }
        Expression::Member(e) => visit_expression(&e.object, out),
        Expression::Index(e) => {
            visit_expression(&e.object, out);
            visit_expression(&e.index, out);
        }
        Expression::Call(e) => {
            visit_expression(&e.callee, out);
            e.args.iter().for_each(|a| visit_expression(a, out));
        }
    }
}

impl<'e> Checker<'e> {
    fn warn(&mut self, message: String, line: u32, column: u32) {
        self.warnings.push(Diagnostic { message, line, column });
    }

    fn describe(&self, shape: &str) -> String {
        match &self.env.describe_shape {
            Some(describe) => describe(shape),
            None => format!("a {shape}"),
        }
    }

    fn global(&self, name: &str) -> Option<Global<'_>> {
        if name == "params" {
            return Some(Global::Declared(&self.params_global));
        }
        if let Some(g) = self.env.globals.get(name) {
            return Some(Global::Declared(g));
        }
        if js::OBJECT_PROTOTYPE_NAMES.contains(&name) {
            return Some(Global::Prototype);
        }
        None
    }

    fn fields(&self, shape: &str) -> Option<&'e ShapeFields> {
        if shape == PARAMS_SHAPE {
            return Some(self.params);
        }
        self.env.shapes.get(shape)
    }

    /// A name's type in the scopes, innermost first; one holding `undefined` doesn't count.
    fn lookup(&self, name: &str) -> Option<CheckedType> {
        self.scopes.iter().rev().find_map(|s| s.names.get(name).cloned().flatten())
    }

    fn set(&mut self, name: &str, ty: Ty) {
        self.scopes.last_mut().expect("a scope").names.insert(name.to_string(), ty);
    }

    fn push(&mut self) {
        self.scopes.push(Scope { names: HashMap::new() });
    }

    fn pop(&mut self) {
        self.scopes.pop();
    }

    /// A block's statements in the current scope. Every name the block declares counts from its
    /// start, so a function may use a `let` declared after it, as it can when called later.
    fn block(&mut self, body: &[Statement]) {
        for s in body {
            match s {
                Statement::Let(s) => self.set(&s.name, UNKNOWN),
                Statement::FunctionDeclaration(s) => self.set(&s.name, UNKNOWN),
                _ => {}
            }
        }
        for s in body {
            self.statement(s);
        }
    }

    /// A block's statements in their own scope.
    fn body(&mut self, block: &BlockStatement) {
        self.push();
        self.block(&block.body);
        self.pop();
    }

    fn statement(&mut self, s: &Statement) {
        match s {
            Statement::Let(s) => {
                let ty = match &s.init {
                    Some(init) => self.expression(init),
                    None => UNKNOWN,
                };
                let ty = if self.reassigned.contains(&s.name) { UNKNOWN } else { ty };
                self.set(&s.name, ty);
            }
            Statement::If(s) => self.if_statement(s),
            Statement::While(s) => {
                self.expression(&s.test);
                self.body(&s.body);
            }
            Statement::ForOf(s) => {
                let list = self.expression(&s.list);
                self.push();
                let item = match list {
                    Some(CheckedType::List(item)) => Some(*item),
                    _ => UNKNOWN,
                };
                let item = if self.reassigned.contains(&s.name) { UNKNOWN } else { item };
                self.set(&s.name, item);
                self.body(&s.body);
                self.pop();
            }
            Statement::FunctionDeclaration(s) => self.function(&s.params, &s.body),
            Statement::Return(s) => {
                if let Some(value) = &s.value {
                    self.expression(value);
                }
            }
            Statement::Block(s) => self.body(s),
            Statement::ExpressionStatement(s) => {
                self.expression(&s.expression);
            }
        }
    }

    fn if_statement(&mut self, s: &IfStatement) {
        self.expression(&s.test);
        self.body(&s.then);
        match s.otherwise.as_deref() {
            Some(Else::If(i)) => self.if_statement(i),
            Some(Else::Block(b)) => self.body(b),
            None => {}
        }
    }

    /// A function's body, with its parameters, whose values it can't know.
    fn function(&mut self, params: &[String], body: &BlockStatement) {
        self.push();
        for p in params {
            self.set(p, UNKNOWN);
        }
        self.body(body);
        self.pop();
    }

    fn expression(&mut self, e: &Expression) -> Ty {
        match e {
            Expression::Number(_)
            | Expression::String(_)
            | Expression::Boolean(_)
            | Expression::Null(_) => UNKNOWN,
            Expression::Identifier(e) => self.identifier(e),
            Expression::List(e) => {
                for item in &e.items {
                    self.expression(item);
                }
                UNKNOWN
            }
            Expression::Object(e) => {
                for p in &e.properties {
                    self.expression(&p.value);
                }
                UNKNOWN
            }
            Expression::Function(e) => {
                self.function(&e.params, &e.body);
                UNKNOWN
            }
            Expression::Unary(e) => {
                self.expression(&e.operand);
                UNKNOWN
            }
            Expression::Binary(e) => {
                self.expression(&e.left);
                self.expression(&e.right);
                UNKNOWN
            }
            Expression::Logical(e) => {
                self.expression(&e.left);
                self.expression(&e.right);
                UNKNOWN
            }
            Expression::Assign(e) => {
                // A field written is the script's own business; reading it is what is checked.
                match e.target.as_ref() {
                    AssignTarget::Identifier(id) => {
                        self.identifier(id);
                    }
                    AssignTarget::Member(m) => {
                        self.expression(&m.object);
                    }
                    AssignTarget::Index(i) => {
                        self.expression(&i.object);
                        self.expression(&i.index);
                    }
                }
                self.expression(&e.value);
                UNKNOWN
            }
            Expression::Member(e) => self.member(e),
            Expression::Index(e) => {
                let object = self.expression(&e.object);
                self.expression(&e.index);
                match object {
                    Some(CheckedType::List(item)) => Some(*item),
                    _ => UNKNOWN,
                }
            }
            Expression::Call(e) => {
                for arg in &e.args {
                    self.expression(arg);
                }
                if let Expression::Identifier(callee) = e.callee.as_ref() {
                    if self.lookup(&callee.name).is_none() {
                        if let Some(Global::Declared(global)) = self.global(&callee.name) {
                            if let Some(params) = &global.params {
                                let (params, ty) = (params.clone(), global.ty.clone());
                                self.arguments(&callee.name, &params, e.args.len(), e);
                                return Some(ty);
                            }
                        }
                    }
                }
                self.expression(&e.callee);
                UNKNOWN
            }
        }
    }

    fn identifier(&mut self, e: &Identifier) -> Ty {
        if let Some(local) = self.lookup(&e.name) {
            return Some(local);
        }
        match self.global(&e.name) {
            None => {
                self.warn(format!("Unknown name \"{}\"", e.name), e.line, e.column);
                UNKNOWN
            }
            Some(Global::Prototype) => None,
            Some(Global::Declared(global)) => {
                if global.params.is_some() {
                    UNKNOWN
                } else {
                    Some(global.ty.clone())
                }
            }
        }
    }

    fn member(&mut self, e: &MemberExpression) -> Ty {
        let object = self.expression(&e.object);
        let (line, column) = (e.property_line, e.property_column);
        let shape = match object {
            Some(CheckedType::List(_)) => {
                if e.property != "length" {
                    self.warn(format!("A list has no \"{}\"", e.property), line, column);
                }
                return UNKNOWN;
            }
            Some(CheckedType::Shape(shape)) => shape,
            _ => return UNKNOWN,
        };
        let Some(fields) = self.fields(&shape) else {
            return UNKNOWN;
        };
        let field = fields.get(&e.property);
        self.reads.push(FieldRead {
            shape: shape.clone(),
            field: e.property.clone(),
            declared: field.is_some(),
            line,
            column,
        });
        match field {
            Some(ty) => Some(ty.clone()),
            None if shape == PARAMS_SHAPE => {
                self.warn(
                    format!(
                        "No param \"{}\": declare it with a \"param\" line at the top",
                        e.property
                    ),
                    line,
                    column,
                );
                UNKNOWN
            }
            None => {
                let described = self.describe(&shape);
                self.warn(
                    format!("\"{}\" is not a field of {described}", e.property),
                    line,
                    column,
                );
                UNKNOWN
            }
        }
    }

    fn arguments(&mut self, name: &str, params: &[String], given: usize, at: &CallExpression) {
        let least = params.iter().filter(|p| !p.ends_with('?')).count();
        if given >= least && given <= params.len() {
            return;
        }
        let count = if least == params.len() {
            least.to_string()
        } else {
            format!("{least} to {}", params.len())
        };
        let names =
            if params.is_empty() { String::new() } else { format!(" ({})", params.join(", ")) };
        let plural = if params.len() == 1 && least == 1 { "" } else { "s" };
        self.warn(
            format!("\"{name}\" takes {count} argument{plural}{names}, not {given}"),
            at.line,
            at.column,
        );
    }
}

/// Checks a parsed script against the names and shapes a script gets.
pub fn check_program(program: &Program, env: &CheckEnv) -> CheckResult {
    // `params` holds the script's own `param` lines, whatever the game passes for it.
    let params: ShapeFields = program
        .params
        .iter()
        .map(|p| {
            let ty = env.param_types.get(&p.ty).cloned().unwrap_or(CheckedType::Unknown);
            (p.name.clone(), ty)
        })
        .collect();
    let mut checker = Checker {
        env,
        params: &params,
        params_global: CheckedGlobal::value(CheckedType::shape(PARAMS_SHAPE)),
        warnings: Vec::new(),
        reads: Vec::new(),
        reassigned: reassigned_names(program),
        scopes: Vec::new(),
    };
    checker.push();
    checker.block(&program.body);
    CheckResult { warnings: checker.warnings, reads: checker.reads }
}

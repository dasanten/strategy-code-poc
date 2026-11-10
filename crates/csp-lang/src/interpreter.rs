//! The tree-walking interpreter (ADR 0001, `CONTEXT.md`: Step budget): the twin of
//! `packages/lang/src/interpreter.ts`. It is pure: it reads and writes only the values it is
//! given, so the same program, globals and budget always give the same result. Every evaluated
//! node costs 1 step, a native function call costs its own `cost` on top, and the run stops when
//! the budget is used up. What the script already did still counts. A value the script builds is
//! bounded too (`CONTEXT.md`: Value limits, `RunOptions::limits`): a string, list or object past
//! its cap is a runtime error.
//!
//! The host gives the script its globals and runs its native functions through [`Host`]. Scopes
//! and the script's functions live in tables owned by one run, so a closure that holds its own
//! scope is no reference cycle: all of it is freed when the run ends.

use std::rc::Rc;

use serde::{Deserialize, Serialize};

use crate::ast::*;
use crate::js;
use crate::value::{FunctionHandle, NativeFunction, ScriptFunction, Value};

/// How deeply evaluation may nest overall, counting every statement, expression and call. It
/// keeps the interpreter itself from running out of stack; real scripts stay far below it.
pub const MAX_EVALUATION_DEPTH: u32 = 1000;

/// A failure of the host itself, not of the script: the run is abandoned and this is passed on
/// (the TypeScript rethrew anything a native function threw that was no `ScriptRuntimeError`).
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct HostError(pub String);

/// Why a native function call failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CallError {
    /// The script used the function wrong (say, a bad argument): the run stops with an `error`
    /// result at the call (`ScriptRuntimeError` in the TypeScript).
    Script(String),
    /// A bug in the host: passed on out of `run`.
    Host(HostError),
}

/// What the interpreter asks of the host: the built-in globals, such as `me`, `memory`, `world`
/// and the actions, and the calls of its native functions. Scripts can't reassign a global, but a
/// list or object in one can change unless it is frozen.
pub trait Host {
    /// The global called `name`, or none if the script gets no such name. Asked at most once per
    /// name in a run, when the script first reads it.
    fn global(&mut self, name: &str) -> Option<Value>;

    /// Calls a native function the host gave the script, with the script's arguments.
    fn call(&mut self, function: &NativeFunction, args: Vec<Value>) -> Result<Value, CallError>;
}

/// The caps on one value a script builds (`CONTEXT.md`: Value limits). A value the host gives the
/// script, such as a long list of what it sees, may be bigger; the script just can't grow it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValueLimits {
    /// The longest string, in characters (UTF-16 code units, as JavaScript counts them).
    pub max_string_length: usize,
    /// The most items in a list.
    pub max_list_length: usize,
    /// The most keys in an object.
    pub max_object_keys: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RunOptions {
    /// How many steps the script may use in this run.
    pub steps: u64,
    /// How deeply script function calls may nest.
    pub max_call_depth: u32,
    /// How big one string, list or object the script builds may get.
    pub limits: ValueLimits,
}

/// How a run ended, the TypeScript's `RunResult`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum RunResult {
    Done {
        steps: u64,
    },
    /// Out of steps at this node, which did not run.
    OutOfSteps {
        steps: u64,
        line: u32,
        column: u32,
    },
    Error {
        steps: u64,
        message: String,
        line: u32,
        column: u32,
    },
}

impl RunResult {
    pub fn steps(&self) -> u64 {
        match self {
            RunResult::Done { steps }
            | RunResult::OutOfSteps { steps, .. }
            | RunResult::Error { steps, .. } => *steps,
        }
    }
}

/// Runs a parsed script once. Fails only for a failure of the host itself.
pub fn run(
    program: &Program,
    host: &mut dyn Host,
    options: &RunOptions,
) -> Result<RunResult, HostError> {
    let mut interpreter = Interpreter {
        steps: 0,
        depth: 0,
        call_depth: 0,
        budget: options.steps,
        max_call_depth: options.max_call_depth,
        limits: options.limits,
        host,
        // Room for a typical run's scopes and functions from the start, rather than growing to
        // it one doubling at a time (T89.6).
        scopes: {
            let mut scopes = Vec::with_capacity(64);
            scopes.push(ScopeData { parent: None, bindings: Vec::with_capacity(16) });
            scopes
        },
        functions: Vec::with_capacity(32),
        run: Rc::new(()),
    };
    let outcome = interpreter.program(program);
    let steps = interpreter.steps;
    match outcome {
        Ok(()) => Ok(RunResult::Done { steps }),
        Err(Signal::OutOfSteps(at)) => {
            Ok(RunResult::OutOfSteps { steps, line: at.line, column: at.column })
        }
        Err(Signal::Failure(failure)) => {
            let (message, at) = *failure;
            Ok(RunResult::Error { steps, message, line: at.line, column: at.column })
        }
        Err(Signal::Host(error)) => Err(error),
        Err(Signal::Return(_)) => Ok(RunResult::Done { steps }),
    }
}

/// What unwinds evaluation: a function body's `return` (at the top level it ends the run), the
/// budget running out, a runtime error, or a failure of the host.
enum Signal {
    Return(Value),
    OutOfSteps(Position),
    Failure(Box<(String, Position)>),
    Host(HostError),
}

type Eval<T> = Result<T, Signal>;

fn fail<T>(message: impl Into<String>, at: Position) -> Eval<T> {
    Err(failure(message, at))
}

fn failure(message: impl Into<String>, at: Position) -> Signal {
    Signal::Failure(Box::new((message.into(), at)))
}

struct Binding {
    value: Value,
    constant: bool,
}

thread_local! {
    /// Function names already made, by where the program holds them. A program run every tick
    /// (an NPC default) declares the same functions each run: they share their name rather than
    /// copying it each time (T89.6). Checked against the text, so a program freed and another
    /// put where it was costs only a new copy.
    static NAMES: std::cell::RefCell<std::collections::HashMap<(usize, usize), Rc<str>>> =
        std::cell::RefCell::default();
}

/// The function name `name` as a shared string, the same one each run of its program.
fn shared_name(name: &str) -> Rc<str> {
    NAMES.with(|names| {
        let mut names = names.borrow_mut();
        let at = (name.as_ptr() as usize, name.len());
        if let Some(shared) = names.get(&at).filter(|s| ***s == *name) {
            return shared.clone();
        }
        if names.len() >= 4096 {
            names.clear();
        }
        let shared: Rc<str> = Rc::from(name);
        names.insert(at, shared.clone());
        shared
    })
}

/// The global scope, where the host's globals are kept once read.
const GLOBALS: usize = 0;

struct ScopeData<'p> {
    parent: Option<usize>,
    bindings: Vec<(&'p str, Binding)>,
}

struct FunctionDef<'p> {
    name: &'p str,
    params: &'p [String],
    body: &'p BlockStatement,
    scope: usize,
}

struct Interpreter<'p, 'h> {
    steps: u64,
    depth: u32,
    call_depth: u32,
    budget: u64,
    max_call_depth: u32,
    limits: ValueLimits,
    host: &'h mut dyn Host,
    scopes: Vec<ScopeData<'p>>,
    functions: Vec<FunctionDef<'p>>,
    run: Rc<()>,
}

#[derive(Clone, Copy)]
enum TooBig {
    String,
    List,
    Object,
}

impl<'p> Interpreter<'p, '_> {
    fn program(&mut self, program: &'p Program) -> Eval<()> {
        let scope = self.new_scope(GLOBALS);
        match self.statements(&program.body, scope) {
            Err(Signal::Return(_)) => Ok(()),
            other => other,
        }
    }

    // --- bookkeeping ---

    fn step(&mut self, at: Position, cost: u64) -> Eval<()> {
        if self.steps.saturating_add(cost) > self.budget {
            return Err(Signal::OutOfSteps(at));
        }
        self.steps += cost;
        Ok(())
    }

    /// Counts one step for the node at `at` and goes one level deeper; the caller comes back up.
    fn enter(&mut self, at: Position) -> Eval<()> {
        self.step(at, 1)?;
        self.depth += 1;
        if self.depth > MAX_EVALUATION_DEPTH {
            return fail("The script nests too deeply", at);
        }
        Ok(())
    }

    fn new_scope(&mut self, parent: usize) -> usize {
        self.scopes.push(ScopeData { parent: Some(parent), bindings: Vec::new() });
        self.scopes.len() - 1
    }

    fn declare(&mut self, scope: usize, name: &'p str, value: Value) -> bool {
        let bindings = &mut self.scopes[scope].bindings;
        if bindings.iter().any(|(n, _)| *n == name) {
            return false;
        }
        bindings.push((name, Binding { value, constant: false }));
        true
    }

    /// Where `name` is bound, seen from `scope`. A global is read from the host the first time
    /// and kept, so the script sees the same value every time.
    fn lookup(&mut self, scope: usize, name: &'p str) -> Option<(usize, usize)> {
        let mut at = Some(scope);
        while let Some(s) = at {
            if let Some(i) = self.scopes[s].bindings.iter().position(|(n, _)| *n == name) {
                return Some((s, i));
            }
            if s == GLOBALS {
                let value = self.host.global(name)?;
                let bindings = &mut self.scopes[GLOBALS].bindings;
                bindings.push((name, Binding { value, constant: true }));
                return Some((GLOBALS, bindings.len() - 1));
            }
            at = self.scopes[s].parent;
        }
        None
    }

    fn binding(&mut self, (scope, index): (usize, usize)) -> &mut Binding {
        &mut self.scopes[scope].bindings[index].1
    }

    fn new_function(
        &mut self,
        name: &'p str,
        params: &'p [String],
        body: &'p BlockStatement,
        scope: usize,
    ) -> Value {
        self.functions.push(FunctionDef { name, params, body, scope });
        Value::Function(ScriptFunction(Rc::new(FunctionHandle {
            run: self.run.clone(),
            index: self.functions.len() - 1,
            name: shared_name(name),
        })))
    }

    // --- statements ---
    //
    // Evaluation recurses once per nested node, so the functions on that path dispatch and do
    // little else; each node's own work, and every error message, is in a function of its own
    // (`#[inline(never)]`), so a deep script needs little stack per level.

    fn statements(&mut self, body: &'p [Statement], scope: usize) -> Eval<()> {
        // Functions can be called before their declaration, as long as it is in the same block.
        for statement in body {
            if let Statement::FunctionDeclaration(f) = statement {
                self.declare_function(f, scope)?;
            }
        }
        for statement in body {
            if !matches!(statement, Statement::FunctionDeclaration(_)) {
                self.statement(statement, scope)?;
            }
        }
        Ok(())
    }

    #[inline(never)]
    fn declare_function(&mut self, f: &'p FunctionDeclaration, scope: usize) -> Eval<()> {
        self.step(f.position(), 1)?;
        let function = self.new_function(&f.name, &f.params, &f.body, scope);
        if !self.declare(scope, &f.name, function) {
            return Err(already_declared(&f.name, f.position()));
        }
        Ok(())
    }

    fn statement(&mut self, node: &'p Statement, scope: usize) -> Eval<()> {
        match node {
            Statement::Block(block) => self.block(block, scope),
            Statement::If(s) => self.if_statement(s, scope),
            _ => {
                self.enter(node.position())?;
                let outcome = self.statement_in(node, scope);
                self.depth -= 1;
                outcome
            }
        }
    }

    /// A `{ … }` as a statement: one node, its statements in their own scope.
    fn block(&mut self, block: &'p BlockStatement, scope: usize) -> Eval<()> {
        self.enter(block.position())?;
        let inner = self.new_scope(scope);
        let outcome = self.statements(&block.body, inner);
        self.depth -= 1;
        outcome
    }

    fn if_statement(&mut self, node: &'p IfStatement, scope: usize) -> Eval<()> {
        self.enter(node.position())?;
        let outcome = self.if_in(node, scope);
        self.depth -= 1;
        outcome
    }

    fn if_in(&mut self, node: &'p IfStatement, scope: usize) -> Eval<()> {
        if self.test(&node.test, scope)? {
            self.block(&node.then, scope)
        } else {
            match node.otherwise.as_deref() {
                Some(Else::Block(block)) => self.block(block, scope),
                Some(Else::If(next)) => self.if_statement(next, scope),
                None => Ok(()),
            }
        }
    }

    /// Whether a condition holds.
    fn test(&mut self, test: &'p Expression, scope: usize) -> Eval<bool> {
        let value = self.expression(test, scope)?;
        Ok(crate::value::truthy(&value))
    }

    fn statement_in(&mut self, node: &'p Statement, scope: usize) -> Eval<()> {
        match node {
            Statement::Let(s) => self.let_statement(s, scope),
            Statement::While(s) => {
                while self.test(&s.test, scope)? {
                    self.block(&s.body, scope)?;
                }
                Ok(())
            }
            Statement::ForOf(s) => self.for_of(s, scope),
            // Declared when its block starts.
            Statement::FunctionDeclaration(_) => Ok(()),
            Statement::Return(s) => Err(Signal::Return(match &s.value {
                Some(value) => self.expression(value, scope)?,
                None => Value::Null,
            })),
            Statement::Block(block) => {
                let inner = self.new_scope(scope);
                self.statements(&block.body, inner)
            }
            Statement::ExpressionStatement(s) => self.expression(&s.expression, scope).map(drop),
            Statement::If(s) => self.if_in(s, scope),
        }
    }

    #[inline(never)]
    fn let_statement(&mut self, s: &'p LetStatement, scope: usize) -> Eval<()> {
        let value = match &s.init {
            Some(init) => self.expression(init, scope)?,
            None => Value::Null,
        };
        if !self.declare(scope, &s.name, value) {
            return Err(already_declared(&s.name, s.position()));
        }
        Ok(())
    }

    #[inline(never)]
    fn for_of(&mut self, s: &'p ForOfStatement, scope: usize) -> Eval<()> {
        let list = self.expression(&s.list, scope)?;
        let Value::List(list) = list else {
            return fail(
                format!("\"for\" needs a list, not {}", describe(&list)),
                s.list.position(),
            );
        };
        // A copy, so changing the list inside the loop doesn't change what it walks over.
        let items = list.borrow().items.clone();
        for item in items {
            let inner = self.new_scope(scope);
            self.declare(inner, &s.name, item);
            self.block(&s.body, inner)?;
        }
        Ok(())
    }

    // --- expressions ---

    fn expression(&mut self, node: &'p Expression, scope: usize) -> Eval<Value> {
        self.enter(node.position())?;
        let value = self.expression_in(node, scope);
        self.depth -= 1;
        value
    }

    #[inline(always)]
    fn expression_in(&mut self, node: &'p Expression, scope: usize) -> Eval<Value> {
        match node {
            Expression::Number(e) => Ok(Value::Number(e.value)),
            Expression::Boolean(e) => Ok(Value::Bool(e.value)),
            Expression::Null(_) => Ok(Value::Null),
            Expression::String(e) => self.string(e),
            Expression::Identifier(e) => self.identifier(e, scope),
            Expression::List(e) => self.list(e, scope),
            Expression::Object(e) => self.object(e, scope),
            Expression::Function(e) => Ok(self.new_function("", &e.params, &e.body, scope)),
            Expression::Unary(e) => self.unary(e, scope),
            Expression::Binary(e) => self.binary(e, scope),
            Expression::Logical(e) => self.logical(e, scope),
            Expression::Assign(e) => self.assign(e, scope),
            Expression::Member(e) => self.member(e, scope),
            Expression::Index(e) => self.index(e, scope),
            Expression::Call(e) => self.call_expression(e, scope),
        }
    }

    #[inline(never)]
    fn string(&mut self, e: &'p StringLiteral) -> Eval<Value> {
        if js::utf16_len(&e.value) > self.limits.max_string_length {
            return Err(self.too_big(TooBig::String, e.position()));
        }
        Ok(Value::string(&e.value))
    }

    #[inline(never)]
    fn identifier(&mut self, e: &'p Identifier, scope: usize) -> Eval<Value> {
        match self.lookup(scope, &e.name) {
            Some(at) => Ok(self.binding(at).value.clone()),
            None => Err(not_defined(&e.name, e.position())),
        }
    }

    #[inline(never)]
    fn list(&mut self, e: &'p ListLiteral, scope: usize) -> Eval<Value> {
        if e.items.len() > self.limits.max_list_length {
            return Err(self.too_big(TooBig::List, e.position()));
        }
        let mut items = Vec::with_capacity(e.items.len());
        for item in &e.items {
            items.push(self.expression(item, scope)?);
        }
        Ok(Value::list(items))
    }

    #[inline(never)]
    fn object(&mut self, e: &'p ObjectLiteral, scope: usize) -> Eval<Value> {
        // The parser refuses a key given twice, so the properties are the keys.
        if e.properties.len() > self.limits.max_object_keys {
            return Err(self.too_big(TooBig::Object, e.position()));
        }
        let object = crate::value::Object::new();
        for property in &e.properties {
            let value = self.expression(&property.value, scope)?;
            object.borrow_mut().insert(property.key.as_str(), value);
        }
        Ok(Value::Object(object))
    }

    #[inline(never)]
    fn unary(&mut self, e: &'p UnaryExpression, scope: usize) -> Eval<Value> {
        let operand = self.expression(&e.operand, scope)?;
        match (e.operator, operand) {
            (UnaryOperator::Not, operand) => Ok(Value::Bool(!crate::value::truthy(&operand))),
            (UnaryOperator::Minus, Value::Number(n)) => Ok(Value::Number(-n)),
            (UnaryOperator::Minus, operand) => {
                fail(format!("\"-\" needs a number, not {}", describe(&operand)), e.position())
            }
        }
    }

    #[inline(never)]
    fn logical(&mut self, e: &'p LogicalExpression, scope: usize) -> Eval<Value> {
        let left = self.expression(&e.left, scope)?;
        let short = match e.operator {
            LogicalOperator::And => !crate::value::truthy(&left),
            LogicalOperator::Or => crate::value::truthy(&left),
        };
        if short {
            return Ok(left);
        }
        self.expression(&e.right, scope)
    }

    #[inline(never)]
    fn member(&mut self, e: &'p MemberExpression, scope: usize) -> Eval<Value> {
        let object = self.expression(&e.object, scope)?;
        // An object's property is read by name, without making a string value of the key.
        if let Value::Object(o) = &object {
            return Ok(o.borrow().get(&e.property).cloned().unwrap_or(Value::Null));
        }
        self.read(&object, &Value::string(&e.property), e.position())
    }

    #[inline(never)]
    fn index(&mut self, e: &'p IndexExpression, scope: usize) -> Eval<Value> {
        let object = self.expression(&e.object, scope)?;
        let index = self.expression(&e.index, scope)?;
        self.read(&object, &index, e.position())
    }

    #[inline(never)]
    fn call_expression(&mut self, e: &'p CallExpression, scope: usize) -> Eval<Value> {
        let callee = self.expression(&e.callee, scope)?;
        let mut args = Vec::with_capacity(e.args.len());
        for arg in &e.args {
            args.push(self.expression(arg, scope)?);
        }
        let at = e.position();
        match callee {
            Value::Native(native) => self.call_native(&native, args, at),
            Value::Function(function) => self.call_function(&function, args, at),
            other => fail(format!("{} is not a function", capitalised(&describe(&other))), at),
        }
    }

    #[inline(never)]
    fn binary(&mut self, node: &'p BinaryExpression, scope: usize) -> Eval<Value> {
        let left = self.expression(&node.left, scope)?;
        let right = self.expression(&node.right, scope)?;
        let op = node.operator;
        let at = node.position();
        match op {
            BinaryOperator::Eq => return Ok(Value::Bool(left.strict_equals(&right))),
            BinaryOperator::NotEq => return Ok(Value::Bool(!left.strict_equals(&right))),
            _ => {}
        }
        if op == BinaryOperator::Add
            && (matches!(left, Value::String(_)) || matches!(right, Value::String(_)))
        {
            let l = text(&left, at)?;
            let r = text(&right, at)?;
            // Checked before joining: the two together could be more than the host can hold.
            if js::utf16_len(&l) + js::utf16_len(&r) > self.limits.max_string_length {
                return Err(self.too_big(TooBig::String, at));
            }
            let mut joined = String::with_capacity(l.len() + r.len());
            joined.push_str(&l);
            joined.push_str(&r);
            return Ok(Value::String(Rc::from(joined)));
        }
        if matches!(
            op,
            BinaryOperator::Less
                | BinaryOperator::LessEq
                | BinaryOperator::Greater
                | BinaryOperator::GreaterEq
        ) {
            let result = match (&left, &right) {
                (Value::Number(l), Value::Number(r)) => match op {
                    BinaryOperator::Less => l < r,
                    BinaryOperator::LessEq => l <= r,
                    BinaryOperator::Greater => l > r,
                    _ => l >= r,
                },
                (Value::String(l), Value::String(r)) => {
                    let order = js::compare_strings(l, r);
                    match op {
                        BinaryOperator::Less => order.is_lt(),
                        BinaryOperator::LessEq => order.is_le(),
                        BinaryOperator::Greater => order.is_gt(),
                        _ => order.is_ge(),
                    }
                }
                _ => {
                    return fail(
                        format!(
                            "\"{}\" compares two numbers or two strings, not {} and {}",
                            op.as_str(),
                            describe(&left),
                            describe(&right)
                        ),
                        at,
                    )
                }
            };
            return Ok(Value::Bool(result));
        }
        let (Value::Number(l), Value::Number(r)) = (&left, &right) else {
            return fail(
                format!(
                    "\"{}\" needs two numbers, not {} and {}",
                    op.as_str(),
                    describe(&left),
                    describe(&right)
                ),
                at,
            );
        };
        let (l, r) = (*l, *r);
        if matches!(op, BinaryOperator::Div | BinaryOperator::Rem) && r == 0.0 {
            return fail("Division by zero", at);
        }
        let result = match op {
            BinaryOperator::Add => l + r,
            BinaryOperator::Sub => l - r,
            BinaryOperator::Mul => l * r,
            BinaryOperator::Div => l / r,
            _ => l % r,
        };
        if !result.is_finite() {
            return fail("The number is too large", at);
        }
        Ok(Value::Number(result))
    }

    #[inline(never)]
    fn assign(&mut self, node: &'p AssignExpression, scope: usize) -> Eval<Value> {
        match node.target.as_ref() {
            AssignTarget::Identifier(target) => {
                let Some(at) = self.lookup(scope, &target.name) else {
                    return Err(not_defined(&target.name, target.position()));
                };
                if self.binding(at).constant {
                    return fail(
                        format!("\"{}\" can't be changed", target.name),
                        target.position(),
                    );
                }
                let value = self.expression(&node.value, scope)?;
                self.binding(at).value = value.clone();
                Ok(value)
            }
            AssignTarget::Member(target) => {
                let object = self.expression(&target.object, scope)?;
                let key = Value::string(&target.property);
                let value = self.expression(&node.value, scope)?;
                self.write(&object, &key, value.clone(), target.position())?;
                Ok(value)
            }
            AssignTarget::Index(target) => {
                let object = self.expression(&target.object, scope)?;
                let key = self.expression(&target.index, scope)?;
                let value = self.expression(&node.value, scope)?;
                self.write(&object, &key, value.clone(), target.position())?;
                Ok(value)
            }
        }
    }

    #[inline(never)]
    fn call_native(
        &mut self,
        native: &NativeFunction,
        args: Vec<Value>,
        at: Position,
    ) -> Eval<Value> {
        self.step(at, native.cost)?;
        match self.host.call(native, args) {
            Ok(value) => Ok(value),
            Err(CallError::Script(message)) => fail(message, at),
            Err(CallError::Host(error)) => Err(Signal::Host(error)),
        }
    }

    fn call_function(
        &mut self,
        function: &ScriptFunction,
        args: Vec<Value>,
        at: Position,
    ) -> Eval<Value> {
        let scope = self.enter_function(function, args, at)?;
        let body = self.functions[function.0.index].body;
        self.call_depth += 1;
        let outcome = self.block(body, scope);
        self.call_depth -= 1;
        match outcome {
            Ok(()) => Ok(Value::Null),
            Err(Signal::Return(value)) => Ok(value),
            Err(other) => Err(other),
        }
    }

    /// Checks a call of a script function and makes its scope with the arguments.
    #[inline(never)]
    fn enter_function(
        &mut self,
        function: &ScriptFunction,
        args: Vec<Value>,
        at: Position,
    ) -> Eval<usize> {
        if !Rc::ptr_eq(&function.0.run, &self.run) {
            // A function kept from another run, which the TypeScript runner never let happen
            // (memory can't keep functions); its scopes are gone.
            return fail("A function from another run can't be called", at);
        }
        let (name, params, closure) = {
            let def = &self.functions[function.0.index];
            (def.name, def.params, def.scope)
        };
        if args.len() > params.len() {
            let name =
                if name.is_empty() { "The function".to_string() } else { format!("\"{name}\"") };
            let plural = if params.len() == 1 { "" } else { "s" };
            return fail(
                format!("{name} takes {} argument{plural}, not {}", params.len(), args.len()),
                at,
            );
        }
        if self.call_depth >= self.max_call_depth {
            return fail(format!("Function calls nest more than {} deep", self.max_call_depth), at);
        }
        let scope = self.new_scope(closure);
        let mut args = args.into_iter();
        for param in params {
            let value = args.next().unwrap_or(Value::Null);
            self.declare(scope, param, value);
        }
        Ok(scope)
    }

    // --- lists and objects ---

    fn read(&mut self, object: &Value, key: &Value, at: Position) -> Eval<Value> {
        match object {
            Value::List(_) | Value::String(_) => {
                if key.as_str() == Some("length") {
                    let length = match object {
                        Value::List(list) => list.borrow().items.len(),
                        Value::String(s) => js::utf16_len(s),
                        _ => unreachable!(),
                    };
                    return Ok(Value::Number(length as f64));
                }
                if let (Value::Number(index), Value::List(list)) = (key, object) {
                    if !is_integer(*index) {
                        return fail("A list index is a whole number", at);
                    }
                    let items = &list.borrow().items;
                    let value = if *index >= 0.0 && *index < items.len() as f64 {
                        items[*index as usize].clone()
                    } else {
                        Value::Null
                    };
                    return Ok(value);
                }
                fail(format!("{} has no {}", capitalised(&describe(object)), describe_key(key)), at)
            }
            Value::Object(object) => {
                let Value::String(key) = key else {
                    return fail(
                        format!("An object's keys are strings, not {}", describe(key)),
                        at,
                    );
                };
                Ok(object.borrow().get(key).cloned().unwrap_or(Value::Null))
            }
            _ => fail(format!("Can't read {} of {}", describe_key(key), describe(object)), at),
        }
    }

    fn write(&mut self, object: &Value, key: &Value, value: Value, at: Position) -> Eval<()> {
        match object {
            Value::List(list) => {
                let length = list.borrow().items.len();
                let index = match key {
                    Value::Number(n) if is_integer(*n) && *n >= 0.0 && *n <= length as f64 => {
                        *n as usize
                    }
                    _ => {
                        return fail(
                            format!(
                                "A list of {length} can be written at 0 to {length}, not {}",
                                describe(key)
                            ),
                            at,
                        )
                    }
                };
                if list.borrow().frozen {
                    return fail("The list can't be changed", at);
                }
                if index == length && length >= self.limits.max_list_length {
                    return Err(self.too_big(TooBig::List, at));
                }
                let mut data = list.borrow_mut();
                if index == length {
                    data.items.push(value);
                } else {
                    data.items[index] = value;
                }
                Ok(())
            }
            Value::Object(object) => {
                let Value::String(key) = key else {
                    return fail(
                        format!("An object's keys are strings, not {}", describe(key)),
                        at,
                    );
                };
                if object.borrow().frozen {
                    return fail("The object can't be changed", at);
                }
                {
                    let data = object.borrow();
                    if !data.contains_key(key) && data.len() >= self.limits.max_object_keys {
                        drop(data);
                        return Err(self.too_big(TooBig::Object, at));
                    }
                }
                object.borrow_mut().insert(&**key, value);
                Ok(())
            }
            _ => fail(format!("Can't set {} of {}", describe_key(key), describe(object)), at),
        }
    }

    /// The error for a value that would grow past its cap (`CONTEXT.md`: Value limits).
    fn too_big(&self, kind: TooBig, at: Position) -> Signal {
        let ValueLimits { max_string_length, max_list_length, max_object_keys } = self.limits;
        let message = match kind {
            TooBig::String => format!("A string can hold at most {max_string_length} characters"),
            TooBig::List => format!("A list can hold at most {max_list_length} items"),
            TooBig::Object => format!("An object can hold at most {max_object_keys} keys"),
        };
        failure(message, at)
    }
}

/// `Number.isInteger`.
fn is_integer(n: f64) -> bool {
    n.is_finite() && n.trunc() == n
}

/// A value joined to a string with `+`, as `String(value)` writes it.
fn text(value: &Value, at: Position) -> Eval<Rc<str>> {
    match value {
        Value::String(s) => Ok(s.clone()),
        Value::Number(n) => Ok(Rc::from(js::number_to_string(*n))),
        Value::Bool(b) => Ok(Rc::from(if *b { "true" } else { "false" })),
        Value::Null => Ok(Rc::from("null")),
        _ => fail("Only numbers, strings, booleans and null can be joined to a string", at),
    }
}

/// How an error message names a value.
pub fn describe(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::List(_) => "a list".into(),
        Value::Function(_) | Value::Native(_) => "a function".into(),
        Value::Object(_) => "an object".into(),
        Value::String(s) => format!("the string {}", js::json_string(s)),
        Value::Number(n) => format!("the number {}", js::number_to_string(*n)),
        Value::Bool(b) => format!("the boolean {b}"),
    }
}

fn describe_key(key: &Value) -> String {
    match key {
        Value::String(s) => format!("\"{s}\""),
        _ => describe(key),
    }
}

fn capitalised(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

#[cold]
#[inline(never)]
fn already_declared(name: &str, at: Position) -> Signal {
    failure(format!("\"{name}\" is already declared here"), at)
}

#[cold]
#[inline(never)]
fn not_defined(name: &str, at: Position) -> Signal {
    failure(format!("\"{name}\" is not defined"), at)
}

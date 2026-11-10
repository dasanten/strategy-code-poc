//! The script language (ADR 0001, ADR 0030): lexer, parser, checker and a tree-walking
//! interpreter with a step budget. Pure: no I/O, threads or clocks, so it also builds to
//! WebAssembly for the editor. The twin of `packages/lang`; its `index.ts` is this file.
//!
//! Parsing and running recurse once per nested node, up to `MAX_NESTING` and
//! `MAX_EVALUATION_DEPTH`. At those caps either needs a little under 512 KB of stack (debug and
//! release builds, measured on Windows), so a 1 MB main thread or a wasm stack is enough.

pub mod ast;
pub mod checker;
pub mod host;
pub mod interpreter;
pub mod js;
pub mod lexer;
pub mod parser;
pub mod plain;
pub mod value;

use serde::{Deserialize, Serialize};

pub use ast::{ParamDeclaration, ParamDefault, ParamType, Program, PARAM_TYPES};
pub use checker::{
    check_program, CheckEnv, CheckResult, CheckedGlobal, CheckedType, FieldRead, PARAMS_SHAPE,
};
pub use host::Globals;
pub use interpreter::{
    run, CallError, Host, HostError, RunOptions, RunResult, ValueLimits, MAX_EVALUATION_DEPTH,
};
pub use lexer::{tokenize, Keyword, ScriptSyntaxError, Token, TokenKind, KEYWORDS};
pub use parser::{parse, MAX_NESTING};
pub use plain::{plain_value, NotPlain, Plain};
pub use value::{truthy, List, NativeFunction, Object, ScriptFunction, Value};

pub const LANGUAGE_VERSION: u32 = 1;

/// A finding at a place in a script.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Diagnostic {
    pub message: String,
    /// 1-based.
    pub line: u32,
    /// 1-based.
    pub column: u32,
}

/// Checks a script against the names and shapes it gets (`check_program`): warnings, and the
/// fields it reads of known shapes. A script with a syntax error gets none; that error is
/// `check_script`'s.
pub fn check_names(source: &str, env: &CheckEnv) -> CheckResult {
    match parse(source) {
        Ok(program) => check_program(&program, env),
        Err(_) => CheckResult::default(),
    }
}

/// A `param` line with the comment at its end, if it has one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParamInfo {
    #[serde(flatten)]
    pub param: ParamDeclaration,
    /// The `//` comment at the end of the line, without the slashes (`CONTEXT.md`: Script
    /// parameter).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub description: Option<String>,
}

/// A script's `param` lines, each with the `//` comment at its end; none for a script with a
/// syntax error.
pub fn script_params(source: &str) -> Vec<ParamInfo> {
    let Ok(program) = parse(source) else {
        return Vec::new();
    };
    let lines: Vec<&str> = source.split('\n').collect();
    program
        .params
        .into_iter()
        .map(|param| {
            let line = lines.get((param.line as usize).wrapping_sub(1)).copied().unwrap_or("");
            ParamInfo { description: param_comment(line), param }
        })
        .collect()
}

/// The comment at the end of a `param` line. A param line holds no string, so its first `//`
/// starts the comment; a line that goes on with a quote before it is left without one.
///
/// The TypeScript's `/^[^"/]*\/\/(.*)$/`: no `"` or `/` before the first `//`, and the rest
/// without a line terminator (so a line ending in `\r` has no comment).
fn param_comment(line: &str) -> Option<String> {
    let start = line.find(['"', '/'])?;
    let rest = line[start..].strip_prefix("//")?;
    if !rest.chars().all(js::regex_dot_matches) {
        return None;
    }
    let trimmed = js::trim(rest);
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// Checks a script for syntax errors. The parser stops at the first one, so there is at most one.
pub fn check_script(source: &str) -> Vec<Diagnostic> {
    match parse(source) {
        Ok(_) => Vec::new(),
        Err(error) => {
            vec![Diagnostic { message: error.message, line: error.line, column: error.column }]
        }
    }
}

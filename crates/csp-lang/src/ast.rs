//! The syntax tree the parser produces: the twin of `packages/lang/src/ast.ts`. Every node is
//! plain serialisable data with the line and column (both 1-based) where it starts, so the
//! interpreter and the editor can point at it. Through serde a node is the same JSON as the
//! TypeScript node: `{ "kind": "Let", "name": …, "init": …, "line": …, "column": … }`.

use serde::{Deserialize, Serialize};

/// Where a node starts, 1-based.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Position {
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "Program")]
pub struct Program {
    /// The script's `param` lines, from its top.
    pub params: Vec<ParamDeclaration>,
    pub body: Vec<Statement>,
}

/// What a `param` can hold.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ParamType {
    Building,
    Storage,
    Number,
    Choice,
    Waypoint,
}

/// Every param type, in the order the TypeScript lists them (`PARAM_TYPES`).
pub const PARAM_TYPES: [ParamType; 5] = [
    ParamType::Building,
    ParamType::Storage,
    ParamType::Number,
    ParamType::Choice,
    ParamType::Waypoint,
];

impl ParamType {
    pub fn as_str(self) -> &'static str {
        match self {
            ParamType::Building => "building",
            ParamType::Storage => "storage",
            ParamType::Number => "number",
            ParamType::Choice => "choice",
            ParamType::Waypoint => "waypoint",
        }
    }

    pub fn from_word(word: &str) -> Option<ParamType> {
        PARAM_TYPES.into_iter().find(|t| t.as_str() == word)
    }
}

/// The `= n` of a `number` param or the `= word` of a `choice` param.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ParamDefault {
    Number(f64),
    Word(String),
}

/// `param name: type`: a value the Player picks for whoever runs the script, read as
/// `params.name`. A `number` param may declare a default, `param name: number = 3`, and a
/// `choice` param one of its words, `param toward: choice(north, south) = north`, that it reads
/// while none is set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParamDeclaration {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: ParamType,
    /// The words a `choice` param is one of, in the order its line lists them.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub choices: Option<Vec<String>>,
    /// The `= n` of a `number` param, a whole number of zero or more, or a `choice` param's word.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub default: Option<ParamDefault>,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)] // Read back by `kind`: see `by_kind!`.
pub enum Statement {
    Let(LetStatement),
    If(IfStatement),
    While(WhileStatement),
    ForOf(ForOfStatement),
    FunctionDeclaration(FunctionDeclaration),
    Return(ReturnStatement),
    Block(BlockStatement),
    ExpressionStatement(ExpressionStatement),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "Let")]
pub struct LetStatement {
    pub name: String,
    pub init: Option<Expression>,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "If")]
pub struct IfStatement {
    pub test: Expression,
    pub then: BlockStatement,
    /// `else { … }` or `else if …`.
    #[serde(rename = "else")]
    pub otherwise: Option<Box<Else>>,
    pub line: u32,
    pub column: u32,
}

/// What follows `else`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Else {
    Block(BlockStatement),
    If(IfStatement),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "While")]
pub struct WhileStatement {
    pub test: Expression,
    pub body: BlockStatement,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "ForOf")]
pub struct ForOfStatement {
    pub name: String,
    pub list: Expression,
    pub body: BlockStatement,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "FunctionDeclaration")]
pub struct FunctionDeclaration {
    pub name: String,
    pub params: Vec<String>,
    pub body: BlockStatement,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "Return")]
pub struct ReturnStatement {
    pub value: Option<Expression>,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "Block")]
pub struct BlockStatement {
    pub body: Vec<Statement>,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "ExpressionStatement")]
pub struct ExpressionStatement {
    pub expression: Expression,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Expression {
    Number(NumberLiteral),
    String(StringLiteral),
    Boolean(BooleanLiteral),
    Null(NullLiteral),
    Identifier(Identifier),
    List(ListLiteral),
    Object(ObjectLiteral),
    Function(FunctionExpression),
    Unary(UnaryExpression),
    Binary(BinaryExpression),
    Logical(LogicalExpression),
    Assign(AssignExpression),
    Member(MemberExpression),
    Index(IndexExpression),
    Call(CallExpression),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "Number")]
pub struct NumberLiteral {
    pub value: f64,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "String")]
pub struct StringLiteral {
    pub value: String,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "Boolean")]
pub struct BooleanLiteral {
    pub value: bool,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "Null")]
pub struct NullLiteral {
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "Identifier")]
pub struct Identifier {
    pub name: String,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "List")]
pub struct ListLiteral {
    pub items: Vec<Expression>,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ObjectProperty {
    pub key: String,
    pub value: Expression,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "Object")]
pub struct ObjectLiteral {
    pub properties: Vec<ObjectProperty>,
    pub line: u32,
    pub column: u32,
}

/// `fn (a, b) { … }`: a function without a name, used as a value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "FunctionExpression")]
pub struct FunctionExpression {
    pub params: Vec<String>,
    pub body: BlockStatement,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UnaryOperator {
    #[serde(rename = "!")]
    Not,
    #[serde(rename = "-")]
    Minus,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "Unary")]
pub struct UnaryExpression {
    pub operator: UnaryOperator,
    pub operand: Box<Expression>,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BinaryOperator {
    #[serde(rename = "==")]
    Eq,
    #[serde(rename = "!=")]
    NotEq,
    #[serde(rename = "<")]
    Less,
    #[serde(rename = "<=")]
    LessEq,
    #[serde(rename = ">")]
    Greater,
    #[serde(rename = ">=")]
    GreaterEq,
    #[serde(rename = "+")]
    Add,
    #[serde(rename = "-")]
    Sub,
    #[serde(rename = "*")]
    Mul,
    #[serde(rename = "/")]
    Div,
    #[serde(rename = "%")]
    Rem,
}

impl BinaryOperator {
    pub fn as_str(self) -> &'static str {
        match self {
            BinaryOperator::Eq => "==",
            BinaryOperator::NotEq => "!=",
            BinaryOperator::Less => "<",
            BinaryOperator::LessEq => "<=",
            BinaryOperator::Greater => ">",
            BinaryOperator::GreaterEq => ">=",
            BinaryOperator::Add => "+",
            BinaryOperator::Sub => "-",
            BinaryOperator::Mul => "*",
            BinaryOperator::Div => "/",
            BinaryOperator::Rem => "%",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "Binary")]
pub struct BinaryExpression {
    pub operator: BinaryOperator,
    pub left: Box<Expression>,
    pub right: Box<Expression>,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LogicalOperator {
    #[serde(rename = "&&")]
    And,
    #[serde(rename = "||")]
    Or,
}

/// `&&` and `||` evaluate their right side only when needed, so they get their own node.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "Logical")]
pub struct LogicalExpression {
    pub operator: LogicalOperator,
    pub left: Box<Expression>,
    pub right: Box<Expression>,
    pub line: u32,
    pub column: u32,
}

/// What `=` can assign to.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum AssignTarget {
    Identifier(Identifier),
    Member(MemberExpression),
    Index(IndexExpression),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "Assign")]
pub struct AssignExpression {
    pub target: Box<AssignTarget>,
    pub value: Box<Expression>,
    pub line: u32,
    pub column: u32,
}

/// `object.name`
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "Member", rename_all = "camelCase")]
pub struct MemberExpression {
    pub object: Box<Expression>,
    pub property: String,
    /// Where the property name starts, so a check can point at it.
    pub property_line: u32,
    pub property_column: u32,
    pub line: u32,
    pub column: u32,
}

/// `object[index]`
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "Index")]
pub struct IndexExpression {
    pub object: Box<Expression>,
    pub index: Box<Expression>,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "Call")]
pub struct CallExpression {
    pub callee: Box<Expression>,
    pub args: Vec<Expression>,
    pub line: u32,
    pub column: u32,
}

macro_rules! positioned {
    ($($t:ty),*) => {
        $(impl $t {
            pub fn position(&self) -> Position {
                Position { line: self.line, column: self.column }
            }
        })*
    };
}

positioned!(
    LetStatement,
    IfStatement,
    WhileStatement,
    ForOfStatement,
    FunctionDeclaration,
    ReturnStatement,
    BlockStatement,
    ExpressionStatement,
    NumberLiteral,
    StringLiteral,
    BooleanLiteral,
    NullLiteral,
    Identifier,
    ListLiteral,
    ObjectLiteral,
    FunctionExpression,
    UnaryExpression,
    BinaryExpression,
    LogicalExpression,
    AssignExpression,
    MemberExpression,
    IndexExpression,
    CallExpression,
    ParamDeclaration,
    ObjectProperty
);

impl Statement {
    pub fn position(&self) -> Position {
        match self {
            Statement::Let(s) => s.position(),
            Statement::If(s) => s.position(),
            Statement::While(s) => s.position(),
            Statement::ForOf(s) => s.position(),
            Statement::FunctionDeclaration(s) => s.position(),
            Statement::Return(s) => s.position(),
            Statement::Block(s) => s.position(),
            Statement::ExpressionStatement(s) => s.position(),
        }
    }
}

impl Expression {
    pub fn position(&self) -> Position {
        match self {
            Expression::Number(e) => e.position(),
            Expression::String(e) => e.position(),
            Expression::Boolean(e) => e.position(),
            Expression::Null(e) => e.position(),
            Expression::Identifier(e) => e.position(),
            Expression::List(e) => e.position(),
            Expression::Object(e) => e.position(),
            Expression::Function(e) => e.position(),
            Expression::Unary(e) => e.position(),
            Expression::Binary(e) => e.position(),
            Expression::Logical(e) => e.position(),
            Expression::Assign(e) => e.position(),
            Expression::Member(e) => e.position(),
            Expression::Index(e) => e.position(),
            Expression::Call(e) => e.position(),
        }
    }
}

impl AssignTarget {
    pub fn position(&self) -> Position {
        match self {
            AssignTarget::Identifier(e) => e.position(),
            AssignTarget::Member(e) => e.position(),
            AssignTarget::Index(e) => e.position(),
        }
    }
}

/// Reads a node of one of `$enum`'s kinds back by its `kind`. Serde's untagged enums would take
/// the first variant whose fields fit, whatever the kind says.
macro_rules! by_kind {
    ($enum:ident { $($kind:literal => $variant:ident),* $(,)? }) => {
        impl<'de> Deserialize<'de> for $enum {
            fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                use serde::de::Error;
                let node = serde_json::Value::deserialize(deserializer)?;
                let kind = node
                    .get("kind")
                    .and_then(serde_json::Value::as_str)
                    .ok_or_else(|| D::Error::custom("a node without a kind"))?
                    .to_string();
                match kind.as_str() {
                    $($kind => serde_json::from_value(node)
                        .map($enum::$variant)
                        .map_err(D::Error::custom),)*
                    other => Err(D::Error::custom(format!(
                        "a {} can't be a \"{other}\"",
                        stringify!($enum)
                    ))),
                }
            }
        }
    };
}

by_kind!(Statement {
    "Let" => Let,
    "If" => If,
    "While" => While,
    "ForOf" => ForOf,
    "FunctionDeclaration" => FunctionDeclaration,
    "Return" => Return,
    "Block" => Block,
    "ExpressionStatement" => ExpressionStatement,
});

by_kind!(Else { "Block" => Block, "If" => If });

by_kind!(Expression {
    "Number" => Number,
    "String" => String,
    "Boolean" => Boolean,
    "Null" => Null,
    "Identifier" => Identifier,
    "List" => List,
    "Object" => Object,
    "FunctionExpression" => Function,
    "Unary" => Unary,
    "Binary" => Binary,
    "Logical" => Logical,
    "Assign" => Assign,
    "Member" => Member,
    "Index" => Index,
    "Call" => Call,
});

by_kind!(AssignTarget {
    "Identifier" => Identifier,
    "Member" => Member,
    "Index" => Index,
});

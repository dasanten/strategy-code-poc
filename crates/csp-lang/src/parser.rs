//! The recursive-descent parser: turns tokens into a syntax tree (ADR 0001, version 1). The twin
//! of `packages/lang/src/parser.ts`. Semicolons between statements are optional.

use crate::ast::*;
use crate::js;
use crate::lexer::{tokenize, Keyword, Punctuator, ScriptSyntaxError, Token, TokenKind};

/// How deeply blocks and expressions may nest. It keeps the parser from running out of stack on
/// a hostile script; real scripts stay far below it.
pub const MAX_NESTING: u32 = 200;

/// Binary operators by precedence, lowest first. Each level is left-associative.
const BINARY_LEVELS: [&[(Punctuator, BinaryOperator)]; 4] = [
    &[(Punctuator::EqEq, BinaryOperator::Eq), (Punctuator::NotEq, BinaryOperator::NotEq)],
    &[
        (Punctuator::Less, BinaryOperator::Less),
        (Punctuator::LessEq, BinaryOperator::LessEq),
        (Punctuator::Greater, BinaryOperator::Greater),
        (Punctuator::GreaterEq, BinaryOperator::GreaterEq),
    ],
    &[(Punctuator::Plus, BinaryOperator::Add), (Punctuator::Minus, BinaryOperator::Sub)],
    &[
        (Punctuator::Star, BinaryOperator::Mul),
        (Punctuator::Slash, BinaryOperator::Div),
        (Punctuator::Percent, BinaryOperator::Rem),
    ],
];

type Parsed<T> = Result<T, ScriptSyntaxError>;

/// Parses a script into a syntax tree.
pub fn parse(source: &str) -> Parsed<Program> {
    Parser { tokens: tokenize(source)?, pos: 0, depth: 0 }.program()
}

struct Parser {
    tokens: Vec<Token>,
    pos: usize,
    depth: u32,
}

impl Parser {
    fn program(&mut self) -> Parsed<Program> {
        let mut params: Vec<ParamDeclaration> = Vec::new();
        while self.is_param() {
            let token = self.peek_at(1).clone();
            let param = self.param()?;
            if params.iter().any(|p| p.name == param.name) {
                return Err(error(
                    at(&token),
                    format!("The param \"{}\" appears twice", param.name),
                ));
            }
            params.push(param);
        }
        let mut body = Vec::new();
        while self.peek().kind != TokenKind::End {
            body.push(self.statement()?);
        }
        Ok(Program { params, body })
    }

    /// Whether a `param name: type` line starts here. `param` is no keyword: `param x :` can't
    /// start anything else, so `param` stays free as a name.
    fn is_param(&self) -> bool {
        matches!(&self.peek().kind, TokenKind::Identifier(w) if w == "param")
            && matches!(self.peek_at(1).kind, TokenKind::Identifier(_))
            && self.peek_at(2).kind == TokenKind::Punctuator(Punctuator::Colon)
    }

    fn param(&mut self) -> Parsed<ParamDeclaration> {
        let start = self.advance();
        let name = self.expect_identifier("a name after \"param\"")?;
        self.expect_punctuator(Punctuator::Colon, &format!("after the param \"{name}\""))?;
        let token = self.peek().clone();
        let ty = match &token.kind {
            TokenKind::Identifier(word) => ParamType::from_word(word),
            _ => None,
        };
        let Some(ty) = ty else {
            let types = PARAM_TYPES
                .iter()
                .map(|t| format!("\"{}\"", t.as_str()))
                .collect::<Vec<_>>()
                .join(" or ");
            return Err(error(
                at(&token),
                format!("Expected {types} after \"param {name}:\" but found {}", describe(&token)),
            ));
        };
        self.advance();
        let choices = if ty == ParamType::Choice { Some(self.param_choices(&name)?) } else { None };
        let default = if self.is_punctuator(Punctuator::Eq) {
            Some(self.param_default(&name, ty, choices.as_deref())?)
        } else {
            None
        };
        self.match_punctuator(Punctuator::Semicolon);
        Ok(ParamDeclaration { name, ty, choices, default, line: start.line, column: start.column })
    }

    /// The `(north, south)` of a `choice` param: one or more words, each once.
    fn param_choices(&mut self, name: &str) -> Parsed<Vec<String>> {
        self.expect_punctuator(Punctuator::LParen, &format!("after \"param {name}: choice\""))?;
        let mut choices: Vec<String> = Vec::new();
        loop {
            let token = self.peek().clone();
            let word = self.expect_identifier(&format!("a word to choose for \"param {name}\""))?;
            if choices.contains(&word) {
                return Err(error(
                    at(&token),
                    format!("The word \"{word}\" appears twice in \"param {name}\""),
                ));
            }
            choices.push(word);
            if !self.match_punctuator(Punctuator::Comma) {
                break;
            }
        }
        self.expect_punctuator(
            Punctuator::RParen,
            &format!("to close the words of \"param {name}\""),
        )?;
        Ok(choices)
    }

    /// The `= n` of a param line: a `number` param's, a whole number of zero or more, or a
    /// `choice` param's, one of its words. No other param has one.
    fn param_default(
        &mut self,
        name: &str,
        ty: ParamType,
        choices: Option<&[String]>,
    ) -> Parsed<ParamDefault> {
        let equals = self.advance();
        if let Some(choices) = choices {
            let token = self.peek().clone();
            match &token.kind {
                TokenKind::Identifier(word) if choices.contains(word) => {
                    self.advance();
                    return Ok(ParamDefault::Word(word.clone()));
                }
                _ => {
                    let words =
                        choices.iter().map(|c| format!("\"{c}\"")).collect::<Vec<_>>().join(" or ");
                    return Err(error(
                        at(&token),
                        format!(
                            "The default of \"param {name}\" must be {words} but found {}",
                            describe(&token)
                        ),
                    ));
                }
            }
        }
        if ty != ParamType::Number {
            return Err(error(
                equals,
                format!(
                    "A \"{}\" param can't have a default, only a \"number\" or \"choice\" param",
                    ty.as_str()
                ),
            ));
        }
        let token = self.peek().clone();
        match token.kind {
            TokenKind::Number(n) if is_safe_integer(n) => {
                self.advance();
                Ok(ParamDefault::Number(n))
            }
            _ => Err(error(
                at(&token),
                format!(
                    "The default of \"param {name}\" must be a whole number of zero or more but found {}",
                    describe(&token)
                ),
            )),
        }
    }

    // --- statements ---

    fn statement(&mut self) -> Parsed<Statement> {
        self.enter()?;
        let statement = self.statement_in();
        self.depth -= 1;
        statement
    }

    fn statement_in(&mut self) -> Parsed<Statement> {
        let token = self.peek().clone();
        if self.is_param() {
            return Err(error(at(&token), "\"param\" lines go at the top of the script"));
        }
        let statement = if self.is_keyword(Keyword::Let) {
            self.let_statement()?
        } else if self.is_keyword(Keyword::If) {
            Statement::If(self.if_statement()?)
        } else if self.is_keyword(Keyword::While) {
            self.while_statement()?
        } else if self.is_keyword(Keyword::For) {
            self.for_statement()?
        } else if self.is_keyword(Keyword::Fn)
            && matches!(self.peek_at(1).kind, TokenKind::Identifier(_))
        {
            self.function_declaration()?
        } else if self.is_keyword(Keyword::Return) {
            self.return_statement()?
        } else if self.is_punctuator(Punctuator::LBrace) {
            Statement::Block(self.block()?)
        } else {
            let expression = self.expression()?;
            Statement::ExpressionStatement(ExpressionStatement {
                expression,
                line: token.line,
                column: token.column,
            })
        };
        self.match_punctuator(Punctuator::Semicolon);
        Ok(statement)
    }

    fn let_statement(&mut self) -> Parsed<Statement> {
        let start = self.expect_keyword(Keyword::Let, "")?;
        let name = self.expect_identifier("a name after \"let\"")?;
        let init =
            if self.match_punctuator(Punctuator::Eq) { Some(self.expression()?) } else { None };
        Ok(Statement::Let(LetStatement { name, init, line: start.line, column: start.column }))
    }

    fn if_statement(&mut self) -> Parsed<IfStatement> {
        let start = self.expect_keyword(Keyword::If, "")?;
        let test = self.condition(Keyword::If)?;
        let then = self.block()?;
        let mut otherwise = None;
        if self.match_keyword(Keyword::Else) {
            otherwise = Some(Box::new(if self.is_keyword(Keyword::If) {
                self.enter()?;
                let nested = self.if_statement();
                self.depth -= 1;
                Else::If(nested?)
            } else {
                Else::Block(self.block()?)
            }));
        }
        Ok(IfStatement { test, then, otherwise, line: start.line, column: start.column })
    }

    fn while_statement(&mut self) -> Parsed<Statement> {
        let start = self.expect_keyword(Keyword::While, "")?;
        let test = self.condition(Keyword::While)?;
        Ok(Statement::While(WhileStatement {
            test,
            body: self.block()?,
            line: start.line,
            column: start.column,
        }))
    }

    fn for_statement(&mut self) -> Parsed<Statement> {
        let start = self.expect_keyword(Keyword::For, "")?;
        self.expect_punctuator(Punctuator::LParen, "after \"for\"")?;
        if self.is_keyword(Keyword::Let) {
            return Err(error(at(self.peek()), "Write \"for (x of list)\" without \"let\""));
        }
        let name = self.expect_identifier("a name in \"for (x of list)\"")?;
        self.expect_keyword(Keyword::Of, "in \"for (x of list)\"")?;
        let list = self.expression()?;
        self.expect_punctuator(Punctuator::RParen, "to close \"for (x of list)\"")?;
        Ok(Statement::ForOf(ForOfStatement {
            name,
            list,
            body: self.block()?,
            line: start.line,
            column: start.column,
        }))
    }

    fn function_declaration(&mut self) -> Parsed<Statement> {
        let start = self.expect_keyword(Keyword::Fn, "")?;
        let name = self.expect_identifier("a function name after \"fn\"")?;
        let params = self.params()?;
        Ok(Statement::FunctionDeclaration(FunctionDeclaration {
            name,
            params,
            body: self.block()?,
            line: start.line,
            column: start.column,
        }))
    }

    fn return_statement(&mut self) -> Parsed<Statement> {
        let start = self.expect_keyword(Keyword::Return, "")?;
        let next = self.peek();
        // A value only counts if it starts on the same line, as in JavaScript.
        let has_value = next.kind != TokenKind::End
            && next.line == start.line
            && !matches!(
                next.kind,
                TokenKind::Punctuator(Punctuator::Semicolon | Punctuator::RBrace)
            );
        let value = if has_value { Some(self.expression()?) } else { None };
        Ok(Statement::Return(ReturnStatement { value, line: start.line, column: start.column }))
    }

    fn block(&mut self) -> Parsed<BlockStatement> {
        let start = self.expect_punctuator(Punctuator::LBrace, "to start a block")?;
        let mut body = Vec::new();
        while !self.is_punctuator(Punctuator::RBrace) {
            if self.peek().kind == TokenKind::End {
                return Err(error(
                    at(self.peek()),
                    format!("The \"{{\" on line {} is never closed with \"}}\"", start.line),
                ));
            }
            body.push(self.statement()?);
        }
        self.advance();
        Ok(BlockStatement { body, line: start.line, column: start.column })
    }

    fn condition(&mut self, keyword: Keyword) -> Parsed<Expression> {
        let word = keyword.as_str();
        self.expect_punctuator(Punctuator::LParen, &format!("after \"{word}\""))?;
        let test = self.expression()?;
        self.expect_punctuator(Punctuator::RParen, &format!("to close the \"{word}\" condition"))?;
        Ok(test)
    }

    fn params(&mut self) -> Parsed<Vec<String>> {
        self.expect_punctuator(Punctuator::LParen, "before the parameters")?;
        let mut params: Vec<String> = Vec::new();
        while !self.is_punctuator(Punctuator::RParen) {
            let token = self.peek().clone();
            let name = self.expect_identifier("a parameter name")?;
            if params.contains(&name) {
                return Err(error(at(&token), format!("The parameter \"{name}\" appears twice")));
            }
            params.push(name);
            if !self.match_punctuator(Punctuator::Comma) {
                break;
            }
        }
        self.expect_punctuator(Punctuator::RParen, "to close the parameters")?;
        Ok(params)
    }

    // --- expressions, lowest precedence first ---

    fn expression(&mut self) -> Parsed<Expression> {
        self.enter()?;
        let expression = self.assignment();
        self.depth -= 1;
        expression
    }

    fn assignment(&mut self) -> Parsed<Expression> {
        let left = self.logical_or()?;
        if !self.is_punctuator(Punctuator::Eq) {
            return Ok(left);
        }
        let equals = self.advance();
        let Position { line, column } = left.position();
        let target = match left {
            Expression::Identifier(e) => AssignTarget::Identifier(e),
            Expression::Member(e) => AssignTarget::Member(e),
            Expression::Index(e) => AssignTarget::Index(e),
            _ => return Err(error(equals, "Only a name, \"a.b\" or \"a[i]\" can be assigned to")),
        };
        // Right-associative: `a = b = 1` sets both.
        let value = self.expression()?;
        Ok(Expression::Assign(AssignExpression {
            target: Box::new(target),
            value: Box::new(value),
            line,
            column,
        }))
    }

    fn logical_or(&mut self) -> Parsed<Expression> {
        let mut left = self.logical_and()?;
        while self.match_punctuator(Punctuator::OrOr) {
            let right = self.logical_and()?;
            let Position { line, column } = left.position();
            left = Expression::Logical(LogicalExpression {
                operator: LogicalOperator::Or,
                left: Box::new(left),
                right: Box::new(right),
                line,
                column,
            });
        }
        Ok(left)
    }

    fn logical_and(&mut self) -> Parsed<Expression> {
        let mut left = self.binary(0)?;
        while self.match_punctuator(Punctuator::AndAnd) {
            let right = self.binary(0)?;
            let Position { line, column } = left.position();
            left = Expression::Logical(LogicalExpression {
                operator: LogicalOperator::And,
                left: Box::new(left),
                right: Box::new(right),
                line,
                column,
            });
        }
        Ok(left)
    }

    /// The binary operators of `level` and above. Precedence climbing: the same left-associative
    /// tree as one function per level, in one stack frame instead of five per nested `(`.
    fn binary(&mut self, level: usize) -> Parsed<Expression> {
        let mut left = self.unary()?;
        loop {
            let found = match self.peek().kind {
                TokenKind::Punctuator(p) => BINARY_LEVELS
                    .iter()
                    .enumerate()
                    .find_map(|(l, ops)| ops.iter().find(|(q, _)| *q == p).map(|(_, op)| (l, *op))),
                _ => None,
            };
            let Some((operator_level, operator)) = found.filter(|(l, _)| *l >= level) else {
                return Ok(left);
            };
            self.advance();
            let right = self.binary(operator_level + 1)?;
            let Position { line, column } = left.position();
            left = Expression::Binary(BinaryExpression {
                operator,
                left: Box::new(left),
                right: Box::new(right),
                line,
                column,
            });
        }
    }

    fn unary(&mut self) -> Parsed<Expression> {
        let operator = match self.peek().kind {
            TokenKind::Punctuator(Punctuator::Bang) => UnaryOperator::Not,
            TokenKind::Punctuator(Punctuator::Minus) => UnaryOperator::Minus,
            _ => return self.postfix(),
        };
        let start = self.advance();
        self.enter()?;
        let operand = self.unary();
        self.depth -= 1;
        Ok(Expression::Unary(UnaryExpression {
            operator,
            operand: Box::new(operand?),
            line: start.line,
            column: start.column,
        }))
    }

    fn postfix(&mut self) -> Parsed<Expression> {
        let mut expression = self.primary()?;
        loop {
            let Position { line, column } = expression.position();
            if self.match_punctuator(Punctuator::Dot) {
                let (property_line, property_column) = (self.peek().line, self.peek().column);
                let property = self.property_name("a property name after \".\"")?;
                expression = Expression::Member(MemberExpression {
                    object: Box::new(expression),
                    property,
                    property_line,
                    property_column,
                    line,
                    column,
                });
            } else if self.match_punctuator(Punctuator::LBracket) {
                let index = self.expression()?;
                self.expect_punctuator(Punctuator::RBracket, "to close \"[\"")?;
                expression = Expression::Index(IndexExpression {
                    object: Box::new(expression),
                    index: Box::new(index),
                    line,
                    column,
                });
            } else if self.match_punctuator(Punctuator::LParen) {
                let args = self.list(Punctuator::RParen, "to close the arguments")?;
                expression = Expression::Call(CallExpression {
                    callee: Box::new(expression),
                    args,
                    line,
                    column,
                });
            } else {
                return Ok(expression);
            }
        }
    }

    fn primary(&mut self) -> Parsed<Expression> {
        // `(` first and on its own: it is the way back into `expression` when parentheses nest,
        // so this frame stays small; the rest lives in a frame of its own.
        if self.is_punctuator(Punctuator::LParen) {
            self.advance();
            let inner = self.expression()?;
            self.expect_punctuator(Punctuator::RParen, "to close \"(\"")?;
            return Ok(inner);
        }
        self.primary_other()
    }

    #[inline(never)]
    fn primary_other(&mut self) -> Parsed<Expression> {
        let token = self.peek().clone();
        let (line, column) = (token.line, token.column);
        match &token.kind {
            TokenKind::Number(value) => {
                self.advance();
                return Ok(Expression::Number(NumberLiteral { value: *value, line, column }));
            }
            TokenKind::String(value) => {
                self.advance();
                return Ok(Expression::String(StringLiteral {
                    value: value.clone(),
                    line,
                    column,
                }));
            }
            TokenKind::Identifier(name) => {
                self.advance();
                return Ok(Expression::Identifier(Identifier { name: name.clone(), line, column }));
            }
            TokenKind::Keyword(Keyword::True | Keyword::False) => {
                self.advance();
                return Ok(Expression::Boolean(BooleanLiteral {
                    value: token.kind == TokenKind::Keyword(Keyword::True),
                    line,
                    column,
                }));
            }
            TokenKind::Keyword(Keyword::Null) => {
                self.advance();
                return Ok(Expression::Null(NullLiteral { line, column }));
            }
            TokenKind::Keyword(Keyword::Fn) => {
                self.advance();
                let params = self.params()?;
                return Ok(Expression::Function(FunctionExpression {
                    params,
                    body: self.block()?,
                    line,
                    column,
                }));
            }
            TokenKind::Punctuator(Punctuator::LBracket) => {
                self.advance();
                return Ok(Expression::List(ListLiteral {
                    items: self.list(Punctuator::RBracket, "to close the list")?,
                    line,
                    column,
                }));
            }
            TokenKind::Punctuator(Punctuator::LBrace) => {
                self.advance();
                return Ok(Expression::Object(ObjectLiteral {
                    properties: self.properties()?,
                    line,
                    column,
                }));
            }
            TokenKind::End => {
                return Err(error(at(&token), "The script ends where a value was expected"));
            }
            _ => {}
        }
        Err(error(at(&token), format!("Expected a value but found {}", describe(&token))))
    }

    /// Comma-separated expressions up to `close`; a trailing comma is allowed.
    fn list(&mut self, close: Punctuator, what: &str) -> Parsed<Vec<Expression>> {
        let mut items = Vec::new();
        while !self.is_punctuator(close) {
            items.push(self.expression()?);
            if !self.match_punctuator(Punctuator::Comma) {
                break;
            }
        }
        self.expect_punctuator(close, what)?;
        Ok(items)
    }

    fn properties(&mut self) -> Parsed<Vec<ObjectProperty>> {
        let mut properties: Vec<ObjectProperty> = Vec::new();
        while !self.is_punctuator(Punctuator::RBrace) {
            let token = self.peek().clone();
            let key = if let TokenKind::String(value) = &token.kind {
                self.advance();
                value.clone()
            } else {
                self.property_name("a key")?
            };
            if properties.iter().any(|p| p.key == key) {
                return Err(error(at(&token), format!("The key \"{key}\" appears twice")));
            }
            self.expect_punctuator(Punctuator::Colon, &format!("after the key \"{key}\""))?;
            let value = self.expression()?;
            properties.push(ObjectProperty { key, value, line: token.line, column: token.column });
            if !self.match_punctuator(Punctuator::Comma) {
                break;
            }
        }
        self.expect_punctuator(Punctuator::RBrace, "to close the object")?;
        Ok(properties)
    }

    /// A name after `.` or as an object key; keywords are fine here (`a.of`, `{ if: 1 }`).
    fn property_name(&mut self, what: &str) -> Parsed<String> {
        let token = self.peek().clone();
        match &token.kind {
            TokenKind::Identifier(name) => {
                self.advance();
                Ok(name.clone())
            }
            TokenKind::Keyword(k) => {
                self.advance();
                Ok(k.as_str().to_string())
            }
            _ => Err(error(at(&token), format!("Expected {what} but found {}", describe(&token)))),
        }
    }

    // --- helpers ---

    /// Goes one level deeper, or fails past `MAX_NESTING`; the caller comes back up.
    fn enter(&mut self) -> Parsed<()> {
        self.depth += 1;
        if self.depth > MAX_NESTING {
            return Err(error(
                at(self.peek()),
                format!("The script nests more than {MAX_NESTING} levels deep"),
            ));
        }
        Ok(())
    }

    fn peek(&self) -> &Token {
        self.peek_at(0)
    }

    fn peek_at(&self, ahead: usize) -> &Token {
        &self.tokens[(self.pos + ahead).min(self.tokens.len() - 1)]
    }

    fn advance(&mut self) -> Position {
        let token = self.peek();
        let position = at(token);
        if token.kind != TokenKind::End {
            self.pos += 1;
        }
        position
    }

    fn is_keyword(&self, value: Keyword) -> bool {
        self.peek().kind == TokenKind::Keyword(value)
    }

    fn is_punctuator(&self, value: Punctuator) -> bool {
        self.peek().kind == TokenKind::Punctuator(value)
    }

    fn match_keyword(&mut self, value: Keyword) -> bool {
        if !self.is_keyword(value) {
            return false;
        }
        self.advance();
        true
    }

    fn match_punctuator(&mut self, value: Punctuator) -> bool {
        if !self.is_punctuator(value) {
            return false;
        }
        self.advance();
        true
    }

    fn expect_keyword(&mut self, value: Keyword, place: &str) -> Parsed<Position> {
        if !self.is_keyword(value) {
            let suffix = if place.is_empty() { String::new() } else { format!(" {place}") };
            return Err(error(
                at(self.peek()),
                format!(
                    "Expected \"{}\"{suffix} but found {}",
                    value.as_str(),
                    describe(self.peek())
                ),
            ));
        }
        Ok(self.advance())
    }

    fn expect_punctuator(&mut self, value: Punctuator, place: &str) -> Parsed<Position> {
        if !self.is_punctuator(value) {
            return Err(error(
                at(self.peek()),
                format!(
                    "Expected \"{}\" {place} but found {}",
                    value.as_str(),
                    describe(self.peek())
                ),
            ));
        }
        Ok(self.advance())
    }

    fn expect_identifier(&mut self, what: &str) -> Parsed<String> {
        let token = self.peek().clone();
        let TokenKind::Identifier(name) = token.kind else {
            return Err(error(
                at(&token),
                format!("Expected {what} but found {}", describe(&token)),
            ));
        };
        self.advance();
        Ok(name)
    }
}

fn at(token: &Token) -> Position {
    Position { line: token.line, column: token.column }
}

fn error(at: Position, message: impl Into<String>) -> ScriptSyntaxError {
    ScriptSyntaxError::new(message, at.line, at.column)
}

/// `Number.isSafeInteger`.
fn is_safe_integer(n: f64) -> bool {
    n.is_finite() && n.trunc() == n && n.abs() <= 9_007_199_254_740_991.0
}

fn describe(token: &Token) -> String {
    match &token.kind {
        TokenKind::End => "the end of the script".into(),
        TokenKind::Number(n) => format!("the number {}", js::number_to_string(*n)),
        TokenKind::String(_) => "a string".into(),
        TokenKind::Identifier(name) => format!("the name \"{name}\""),
        TokenKind::Keyword(k) => format!("\"{}\"", k.as_str()),
        TokenKind::Punctuator(p) => format!("\"{}\"", p.as_str()),
    }
}

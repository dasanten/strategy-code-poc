//! The lexer: turns script source into tokens, each with the line and column (1-based) it starts
//! at. The twin of `packages/lang/src/lexer.ts`.
//!
//! Columns count UTF-16 code units, as the TypeScript does (a JavaScript string is UTF-16), so a
//! position means the same in both and in the editor.

use serde::ser::SerializeMap;
use serde::{Serialize, Serializer};

use crate::js;

/// The words the language keeps for itself.
pub const KEYWORDS: [&str; 11] =
    ["let", "if", "else", "while", "for", "of", "fn", "return", "true", "false", "null"];

/// A word the language keeps for itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Keyword {
    Let,
    If,
    Else,
    While,
    For,
    Of,
    Fn,
    Return,
    True,
    False,
    Null,
}

impl Keyword {
    pub fn as_str(self) -> &'static str {
        match self {
            Keyword::Let => "let",
            Keyword::If => "if",
            Keyword::Else => "else",
            Keyword::While => "while",
            Keyword::For => "for",
            Keyword::Of => "of",
            Keyword::Fn => "fn",
            Keyword::Return => "return",
            Keyword::True => "true",
            Keyword::False => "false",
            Keyword::Null => "null",
        }
    }

    fn from_word(word: &str) -> Option<Keyword> {
        Some(match word {
            "let" => Keyword::Let,
            "if" => Keyword::If,
            "else" => Keyword::Else,
            "while" => Keyword::While,
            "for" => Keyword::For,
            "of" => Keyword::Of,
            "fn" => Keyword::Fn,
            "return" => Keyword::Return,
            "true" => Keyword::True,
            "false" => Keyword::False,
            "null" => Keyword::Null,
            _ => return None,
        })
    }
}

/// Operators and punctuation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Punctuator {
    EqEq,
    NotEq,
    LessEq,
    GreaterEq,
    AndAnd,
    OrOr,
    LParen,
    RParen,
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Comma,
    Colon,
    Semicolon,
    Dot,
    Eq,
    Less,
    Greater,
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    Bang,
}

/// Every punctuator, longest first so `<=` wins over `<`.
const PUNCTUATORS: [Punctuator; 25] = [
    Punctuator::EqEq,
    Punctuator::NotEq,
    Punctuator::LessEq,
    Punctuator::GreaterEq,
    Punctuator::AndAnd,
    Punctuator::OrOr,
    Punctuator::LParen,
    Punctuator::RParen,
    Punctuator::LBrace,
    Punctuator::RBrace,
    Punctuator::LBracket,
    Punctuator::RBracket,
    Punctuator::Comma,
    Punctuator::Colon,
    Punctuator::Semicolon,
    Punctuator::Dot,
    Punctuator::Eq,
    Punctuator::Less,
    Punctuator::Greater,
    Punctuator::Plus,
    Punctuator::Minus,
    Punctuator::Star,
    Punctuator::Slash,
    Punctuator::Percent,
    Punctuator::Bang,
];

impl Punctuator {
    pub fn as_str(self) -> &'static str {
        match self {
            Punctuator::EqEq => "==",
            Punctuator::NotEq => "!=",
            Punctuator::LessEq => "<=",
            Punctuator::GreaterEq => ">=",
            Punctuator::AndAnd => "&&",
            Punctuator::OrOr => "||",
            Punctuator::LParen => "(",
            Punctuator::RParen => ")",
            Punctuator::LBrace => "{",
            Punctuator::RBrace => "}",
            Punctuator::LBracket => "[",
            Punctuator::RBracket => "]",
            Punctuator::Comma => ",",
            Punctuator::Colon => ":",
            Punctuator::Semicolon => ";",
            Punctuator::Dot => ".",
            Punctuator::Eq => "=",
            Punctuator::Less => "<",
            Punctuator::Greater => ">",
            Punctuator::Plus => "+",
            Punctuator::Minus => "-",
            Punctuator::Star => "*",
            Punctuator::Slash => "/",
            Punctuator::Percent => "%",
            Punctuator::Bang => "!",
        }
    }
}

/// What a token is, with its value.
#[derive(Debug, Clone, PartialEq)]
pub enum TokenKind {
    Number(f64),
    String(String),
    Identifier(String),
    Keyword(Keyword),
    Punctuator(Punctuator),
    End,
}

/// A token with the line and column (both 1-based) where it starts.
#[derive(Debug, Clone, PartialEq)]
pub struct Token {
    pub kind: TokenKind,
    pub line: u32,
    pub column: u32,
}

/// The TypeScript's shape: `{ type, value, line, column }`, without `value` for `end`.
impl Serialize for Token {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(None)?;
        match &self.kind {
            TokenKind::Number(n) => {
                map.serialize_entry("type", "number")?;
                map.serialize_entry("value", n)?;
            }
            TokenKind::String(s) => {
                map.serialize_entry("type", "string")?;
                map.serialize_entry("value", s)?;
            }
            TokenKind::Identifier(s) => {
                map.serialize_entry("type", "identifier")?;
                map.serialize_entry("value", s)?;
            }
            TokenKind::Keyword(k) => {
                map.serialize_entry("type", "keyword")?;
                map.serialize_entry("value", k.as_str())?;
            }
            TokenKind::Punctuator(p) => {
                map.serialize_entry("type", "punctuator")?;
                map.serialize_entry("value", p.as_str())?;
            }
            TokenKind::End => map.serialize_entry("type", "end")?,
        }
        map.serialize_entry("line", &self.line)?;
        map.serialize_entry("column", &self.column)?;
        map.end()
    }
}

/// A syntax error in a script, at the line and column (1-based) where it was found.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, Serialize)]
#[error("{message}")]
pub struct ScriptSyntaxError {
    pub message: String,
    pub line: u32,
    pub column: u32,
}

impl ScriptSyntaxError {
    pub fn new(message: impl Into<String>, line: u32, column: u32) -> Self {
        ScriptSyntaxError { message: message.into(), line, column }
    }
}

fn escape(c: u16) -> Option<u16> {
    Some(match c {
        0x6E => 0x0A, // n
        0x74 => 0x09, // t
        0x72 => 0x0D, // r
        0x5C => 0x5C, // \
        0x22 => 0x22, // "
        0x27 => 0x27, // '
        _ => return None,
    })
}

fn is_digit(c: Option<u16>) -> bool {
    matches!(c, Some(c) if (0x30..=0x39).contains(&c))
}

fn is_ident_start(c: Option<u16>) -> bool {
    matches!(c, Some(c) if (0x61..=0x7A).contains(&c) || (0x41..=0x5A).contains(&c) || c == 0x5F)
}

fn is_ident_part(c: Option<u16>) -> bool {
    is_ident_start(c) || is_digit(c)
}

/// Splits source into tokens, ending with an `end` token.
pub fn tokenize(source: &str) -> Result<Vec<Token>, ScriptSyntaxError> {
    let src: Vec<u16> = source.encode_utf16().collect();
    let at = |i: usize| src.get(i).copied();
    let mut tokens = Vec::new();
    let mut pos = 0usize;
    let mut line = 1u32;
    let mut line_start = 0usize;

    macro_rules! column {
        () => {
            (pos - line_start + 1) as u32
        };
    }

    while pos < src.len() {
        let c = src[pos];

        if c == 0x0A {
            pos += 1;
            line += 1;
            line_start = pos;
            continue;
        }
        if c == 0x20 || c == 0x09 || c == 0x0D {
            pos += 1;
            continue;
        }

        // Comments: `// to the end of the line` and `/* across lines */`.
        if c == 0x2F && at(pos + 1) == Some(0x2F) {
            while pos < src.len() && src[pos] != 0x0A {
                pos += 1;
            }
            continue;
        }
        if c == 0x2F && at(pos + 1) == Some(0x2A) {
            let start_line = line;
            let start_column = column!();
            pos += 2;
            while pos < src.len() && !(src[pos] == 0x2A && at(pos + 1) == Some(0x2F)) {
                pos += 1;
                if src[pos - 1] == 0x0A {
                    line += 1;
                    line_start = pos;
                }
            }
            if pos >= src.len() {
                return Err(ScriptSyntaxError::new(
                    "This comment is never closed with */",
                    start_line,
                    start_column,
                ));
            }
            pos += 2;
            continue;
        }

        let start_column = column!();

        if is_digit(Some(c)) {
            let start = pos;
            while pos < src.len() && is_digit(at(pos)) {
                pos += 1;
            }
            if at(pos) == Some(0x2E) && is_digit(at(pos + 1)) {
                pos += 1;
                while pos < src.len() && is_digit(at(pos)) {
                    pos += 1;
                }
            }
            if is_ident_start(at(pos)) {
                return Err(ScriptSyntaxError::new(
                    format!("Unexpected \"{}\" after a number", char::from(src[pos] as u8)),
                    line,
                    column!(),
                ));
            }
            let text = String::from_utf16_lossy(&src[start..pos]);
            // Digits with an optional fraction always parse; a huge one is infinity, as `Number`.
            let value = text.parse::<f64>().unwrap_or(f64::INFINITY);
            tokens.push(Token { kind: TokenKind::Number(value), line, column: start_column });
            continue;
        }

        if is_ident_start(Some(c)) {
            let start = pos;
            while pos < src.len() && is_ident_part(at(pos)) {
                pos += 1;
            }
            let word = String::from_utf16_lossy(&src[start..pos]);
            let kind = match Keyword::from_word(&word) {
                Some(k) => TokenKind::Keyword(k),
                None => TokenKind::Identifier(word),
            };
            tokens.push(Token { kind, line, column: start_column });
            continue;
        }

        if c == 0x22 || c == 0x27 {
            pos += 1;
            let mut value: Vec<u16> = Vec::new();
            loop {
                let ch = at(pos);
                let Some(ch) = ch.filter(|&ch| ch != 0x0A) else {
                    return Err(ScriptSyntaxError::new(
                        format!("This string is never closed with {}", char::from(c as u8)),
                        line,
                        start_column,
                    ));
                };
                if ch == c {
                    pos += 1;
                    break;
                }
                if ch == 0x5C {
                    let escaped = at(pos + 1);
                    match escaped.and_then(escape) {
                        Some(replacement) => {
                            value.push(replacement);
                            pos += 2;
                            continue;
                        }
                        None => {
                            let shown =
                                escaped.map(|e| String::from_utf16_lossy(&[e])).unwrap_or_default();
                            return Err(ScriptSyntaxError::new(
                                format!("Unknown escape \"\\{shown}\" in a string"),
                                line,
                                column!(),
                            ));
                        }
                    }
                }
                value.push(ch);
                pos += 1;
            }
            tokens.push(Token {
                kind: TokenKind::String(String::from_utf16_lossy(&value)),
                line,
                column: start_column,
            });
            continue;
        }

        let punctuator = PUNCTUATORS.iter().copied().find(|p| {
            let text = p.as_str().as_bytes();
            text.iter().enumerate().all(|(i, &b)| at(pos + i) == Some(u16::from(b)))
        });
        if let Some(p) = punctuator {
            pos += p.as_str().len();
            tokens.push(Token { kind: TokenKind::Punctuator(p), line, column: start_column });
            continue;
        }

        return Err(ScriptSyntaxError::new(
            format!("Unexpected character \"{}\"", js::code_unit_text(c)),
            line,
            start_column,
        ));
    }

    tokens.push(Token { kind: TokenKind::End, line, column: column!() });
    Ok(tokens)
}

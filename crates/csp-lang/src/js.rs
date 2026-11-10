//! The bits of JavaScript behaviour the TypeScript language relied on without saying so: how a
//! number is written (`String(n)`), how a string is quoted (`JSON.stringify(s)`), string length
//! and order by UTF-16 code units, and the order of an object's keys.

use std::cmp::Ordering;

/// `String(n)` for a JavaScript number (ECMAScript `Number::toString`, radix 10).
pub fn number_to_string(n: f64) -> String {
    if n.is_nan() {
        return "NaN".into();
    }
    if n == 0.0 {
        return "0".into();
    }
    if n.is_infinite() {
        return if n > 0.0 { "Infinity" } else { "-Infinity" }.into();
    }
    // Rust's `{:e}` writes the shortest digits that read back as the same number, as the
    // ECMAScript algorithm asks for.
    let formatted = format!("{:e}", n.abs());
    let (mantissa, exponent) = formatted.split_once('e').expect("{:e} has an exponent");
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32;
    let point = exponent.parse::<i32>().expect("{:e} exponent is a number") + 1;
    let body = if k <= point && point <= 21 {
        format!("{digits}{}", "0".repeat((point - k) as usize))
    } else if 0 < point && point <= 21 {
        let (whole, fraction) = digits.split_at(point as usize);
        format!("{whole}.{fraction}")
    } else if -6 < point && point <= 0 {
        format!("0.{}{digits}", "0".repeat((-point) as usize))
    } else {
        let e = point - 1;
        let sign = if e >= 0 { '+' } else { '-' };
        let (first, rest) = digits.split_at(1);
        if rest.is_empty() {
            format!("{first}e{sign}{}", e.abs())
        } else {
            format!("{first}.{rest}e{sign}{}", e.abs())
        }
    };
    if n < 0.0 {
        format!("-{body}")
    } else {
        body
    }
}

/// `JSON.stringify(s)` for a string.
pub fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0C}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// A string's `length`: its UTF-16 code units.
pub fn utf16_len(s: &str) -> usize {
    if s.is_ascii() {
        return s.len();
    }
    s.chars().map(char::len_utf16).sum()
}

/// How JavaScript orders two strings with `<`: by UTF-16 code units.
pub fn compare_strings(a: &str, b: &str) -> Ordering {
    if a.is_ascii() && b.is_ascii() {
        return a.cmp(b);
    }
    a.encode_utf16().cmp(b.encode_utf16())
}

/// One UTF-16 code unit as text, as JavaScript would show it; a lone surrogate can't be held in
/// a Rust string and shows as U+FFFD.
pub fn code_unit_text(unit: u16) -> String {
    String::from_utf16_lossy(&[unit])
}

/// Whether a key is an array index (`"0"`, `"17"`, below 2^32 - 1, no leading zeros). JavaScript
/// lists an object's array-index keys first, in numeric order, then the others as inserted.
pub fn array_index(key: &str) -> Option<u32> {
    if key.is_empty() || key.len() > 10 || !key.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if key.len() > 1 && key.starts_with('0') {
        return None;
    }
    let n: u64 = key.parse().ok()?;
    if n < u64::from(u32::MAX) {
        Some(n as u32)
    } else {
        None
    }
}

/// JavaScript's whitespace for `String.prototype.trim`: WhiteSpace and LineTerminator.
fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\u{09}'
            | '\u{0B}'
            | '\u{0C}'
            | '\u{20}'
            | '\u{A0}'
            | '\u{FEFF}'
            | '\u{0A}'
            | '\u{0D}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}' | '\u{202F}' | '\u{205F}' | '\u{3000}'
    )
}

/// `String.prototype.trim`.
pub fn trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

/// Whether a regular expression's `.` (without the `s` flag) matches `c`: anything but a line
/// terminator.
pub fn regex_dot_matches(c: char) -> bool {
    !matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// The names every plain JavaScript object has through its prototype. The checker looked a
/// global up as `globals[name]` on a plain object, so these names were "found" there.
pub const OBJECT_PROTOTYPE_NAMES: [&str; 12] = [
    "constructor",
    "__defineGetter__",
    "__defineSetter__",
    "hasOwnProperty",
    "__lookupGetter__",
    "__lookupSetter__",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toString",
    "valueOf",
    "__proto__",
    "toLocaleString",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_numbers_as_javascript_does() {
        let cases: [(f64, &str); 16] = [
            (1.0, "1"),
            (1.5, "1.5"),
            (-0.0, "0"),
            (0.1 + 0.2, "0.30000000000000004"),
            (1e21, "1e+21"),
            (1e20, "100000000000000000000"),
            (123456789012345680000.0, "123456789012345680000"),
            (1e-6, "0.000001"),
            (1e-7, "1e-7"),
            (1.5e-7, "1.5e-7"),
            (-2.5e30, "-2.5e+30"),
            (f64::MAX, "1.7976931348623157e+308"),
            (5e-324, "5e-324"),
            (610.0, "610"),
            (-5.0, "-5"),
            (0.000123, "0.000123"),
        ];
        for (n, text) in cases {
            assert_eq!(number_to_string(n), text, "{n:?}");
        }
    }

    #[test]
    fn knows_array_index_keys() {
        assert_eq!(array_index("0"), Some(0));
        assert_eq!(array_index("17"), Some(17));
        assert_eq!(array_index("4294967294"), Some(4_294_967_294));
        assert_eq!(array_index("4294967295"), None);
        assert_eq!(array_index("01"), None);
        assert_eq!(array_index("-1"), None);
        assert_eq!(array_index("a"), None);
        assert_eq!(array_index(""), None);
    }
}

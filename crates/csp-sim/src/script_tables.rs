//! The script tables: the source of what a script sees and the client is told of it, one module
//! per table. The actions that ask for an order stand with their orders (`script_actions`). The
//! tables are the script views (`views`), the game API of a resident's (`api`) and of an
//! army's script (`army_api`), what a param accepts (`param_descriptions`) and the default scripts
//! (`default_scripts`, each script a file of its own). After a change run `pnpm script-data:rust`.

mod api;
mod army_api;
mod default_scripts;
mod param_descriptions;
mod views;

pub use api::SCRIPT_API;
pub use army_api::ARMY_SCRIPT_API;
pub use default_scripts::DEFAULT_SCRIPTS;
pub use param_descriptions::PARAM_DESCRIPTIONS;
pub use views::{SCRIPT_VIEWS, SCRIPT_VIEW_CHANGES};

/// A description with a list of names in it: `"before \"a\", \"b\" or \"c\" after"`.
macro_rules! names_text {
    ($before:expr, $names:expr, $after:expr) => {{
        const LEN: usize = crate::script_tables::names_text_len($before, &$names, $after);
        const BYTES: [u8; LEN] = crate::script_tables::names_text_bytes($before, &$names, $after);
        match str::from_utf8(&BYTES) {
            Ok(text) => text,
            Err(_) => panic!("not UTF-8"),
        }
    }};
}
use names_text;

/// How long a [`names_text`] is, in bytes.
const fn names_text_len(before: &str, names: &[&str], after: &str) -> usize {
    let mut n = before.len() + after.len();
    let mut i = 0;
    while i < names.len() {
        n += names[i].len() + 2;
        n += if i + 1 == names.len() { 0 } else { separator(i, names.len()).len() };
        i += 1;
    }
    n
}

/// What follows name `i` of `count` in a list.
const fn separator(i: usize, count: usize) -> &'static str {
    if i + 2 == count {
        " or "
    } else {
        ", "
    }
}

/// A [`names_text`]'s bytes; `N` is its [`names_text_len`].
const fn names_text_bytes<const N: usize>(before: &str, names: &[&str], after: &str) -> [u8; N] {
    let mut out = [0; N];
    let mut n = put(&mut out, 0, before);
    let mut i = 0;
    while i < names.len() {
        n = put(&mut out, n, "\"");
        n = put(&mut out, n, names[i]);
        n = put(&mut out, n, "\"");
        if i + 1 < names.len() {
            n = put(&mut out, n, separator(i, names.len()));
        }
        i += 1;
    }
    put(&mut out, n, after);
    out
}

/// Writes `text` into `out` from `at`, and says where it ends.
const fn put(out: &mut [u8], at: usize, text: &str) -> usize {
    let mut i = 0;
    while i < text.len() {
        out[at + i] = text.as_bytes()[i];
        i += 1;
    }
    at + i
}

/// How many entries a table's parts have together.
const fn total<T>(parts: &[&[T]]) -> usize {
    let mut n = 0;
    let mut i = 0;
    while i < parts.len() {
        n += parts[i].len();
        i += 1;
    }
    n
}

/// A table's parts as one, in their order; `N` is their [`total`].
const fn joined<T: Copy, const N: usize>(parts: &[&[T]]) -> [T; N] {
    let mut all = [parts[0][0]; N];
    let mut n = 0;
    let mut i = 0;
    while i < parts.len() {
        let mut j = 0;
        while j < parts[i].len() {
            all[n] = parts[i][j];
            n += 1;
            j += 1;
        }
        i += 1;
    }
    all
}

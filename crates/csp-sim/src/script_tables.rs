//! The script tables: the source of what a script sees and the client is told of it, one module
//! per table. They are the script views (`views`), the game API of a resident's (`api`) and of an
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

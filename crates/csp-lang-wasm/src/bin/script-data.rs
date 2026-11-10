//! Writes the game's script tables to `packages/lang-wasm/script-data.json` (`pnpm
//! script-data:rust`); `tests/script_data.rs` fails while the file is stale.

use std::path::Path;

fn main() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let path = root.join(csp_lang_wasm::SCRIPT_DATA_PATH);
    std::fs::write(&path, csp_lang_wasm::script_data()).expect("script-data.json is writable");
    println!("wrote {}", path.display());
}

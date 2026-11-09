//! `pnpm types:rust`: writes the client's types into `packages/shared-types` (T88.1).

use csp_server::client_types::{export_into, workspace_root, GENERATED_DIR};

fn main() {
    let dir = workspace_root().join(GENERATED_DIR);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).expect("clear the old generated files");
    }
    export_into(&dir).expect("write the generated types");
    println!("wrote {}", dir.display());
}

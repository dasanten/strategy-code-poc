//! `wasm-bindgen-cli` must be the version of the `wasm-bindgen` crate, or the bindings it writes
//! don't fit the module. CI and the Docker image install it by version; they follow Cargo.lock.

use std::path::Path;

#[test]
fn ci_and_the_image_install_the_locked_wasm_bindgen() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let read = |p: &str| std::fs::read_to_string(root.join(p)).expect(p).replace("\r\n", "\n");
    let lock = read("Cargo.lock");
    let at = lock.find("name = \"wasm-bindgen\"\nversion = \"").expect("wasm-bindgen is locked");
    let version = lock[at..].split('"').nth(3).expect("its version");
    assert!(read("Dockerfile").contains(&format!("wasm-bindgen-cli --version {version}")));
    assert!(read(".github/workflows/ci.yml").contains(&format!("tool: wasm-bindgen@{version}")));
}

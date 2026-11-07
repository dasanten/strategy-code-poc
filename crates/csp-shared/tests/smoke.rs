//! Proves nextest sees this crate (T84.1).

#[test]
fn csp_shared_smoke() {
    assert_eq!(env!("CARGO_PKG_NAME"), "csp-shared");
}

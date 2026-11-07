//! Proves nextest sees this crate (T84.1).

#[test]
fn csp_sim_smoke() {
    assert_eq!(env!("CARGO_PKG_NAME"), "csp-sim");
}

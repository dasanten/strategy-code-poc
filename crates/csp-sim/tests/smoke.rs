//! Proves nextest sees this crate (T84.1).

#[test]
fn csp_sim_smoke() {
    csp_npc::install(); // T1719
    assert_eq!(env!("CARGO_PKG_NAME"), "csp-sim");
}

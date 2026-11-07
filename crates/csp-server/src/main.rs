//! The game server (ADR 0030): runs the world at one tick a second and serves the client. The
//! tick loop, HTTP, WebSocket sync and storage arrive with Epic 87; until then this only says so.

fn main() {
    println!(
        "csp-server: the Rust backend is being built (ADR 0030); tick every {} ms",
        csp_shared::TICK_MS
    );
}

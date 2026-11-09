//! The balance JSON the client reads (T88.4): `packages/balance/` is exactly what the Rust table
//! writes now, so a changed number cannot reach the Wiki unnoticed.

use std::path::Path;

use csp_shared::balance_export::{export_json, files};

#[test]
fn the_files_in_packages_balance_are_not_stale() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    for (path, text) in files() {
        let on_disk = std::fs::read_to_string(root.join(&path)).unwrap_or_default();
        // A checkout with CRLF line endings is the same file.
        assert!(
            on_disk.replace("\r\n", "\n") == text,
            "{path} is stale: run `pnpm balance:rust` and commit the result"
        );
    }
}

#[test]
fn the_export_has_the_numbers_the_wiki_reads() {
    let json = export_json();
    assert_eq!(json["ADULT_AGE"], 14.0);
    assert_eq!(json["TICKS_PER_GAME_DAY"], 1440.0);
    assert_eq!(json["TICKS_PER_GAME_HOUR"], 60.0);
    assert_eq!(json["GAME_DAYS_PER_YEAR"], 420.0);
    assert_eq!(json["TICK_MS"], 1000);
    assert_eq!(json["TERRAIN"]["Plains"], 0);
    assert_eq!(json["TERRAIN"]["Road"], 6);
    assert_eq!(json["FOOTPRINT"]["townHall"], 3);
}

#[test]
fn the_declarations_name_every_number() {
    let json = export_json();
    let dts = csp_shared::balance_export::dts_text();
    let constants = csp_shared::balance_export::constants_text();
    for key in json.as_object().unwrap().keys() {
        assert!(dts.contains(&format!("readonly {key}: ")), "{key} missing in balance.d.ts");
        assert!(
            constants.contains(&format!("export const {key} = balance.{key}\n")),
            "{key} missing in constants.ts"
        );
    }
}

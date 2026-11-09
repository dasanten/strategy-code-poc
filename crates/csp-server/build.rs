//! Embeds the migration SQL files listed in `migrations/meta/_journal.json` (the Drizzle journal
//! format, so the TypeScript server's entries and later Rust ones share one list).
use std::{env, fs, path::Path};

fn main() {
    println!("cargo:rerun-if-changed=migrations");
    let dir = Path::new(&env::var("CARGO_MANIFEST_DIR").unwrap()).join("migrations");
    let journal: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(dir.join("meta/_journal.json")).unwrap()).unwrap();
    let mut out = String::from("pub const EMBEDDED: &[(&str, i64, &str)] = &[\n");
    for e in journal["entries"].as_array().unwrap() {
        let tag = e["tag"].as_str().unwrap();
        let when = e["when"].as_i64().unwrap();
        let file = dir.join(format!("{tag}.sql"));
        out.push_str(&format!(
            "    ({tag:?}, {when}, include_str!({:?})),\n",
            file.to_str().unwrap()
        ));
    }
    out.push_str("];\n");
    fs::write(Path::new(&env::var("OUT_DIR").unwrap()).join("migrations.rs"), out).unwrap();
}

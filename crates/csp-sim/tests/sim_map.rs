//! `docs/architecture/sim.md`, the map of this crate, is checked against the code (T124.1): every
//! top-level module of `src/lib.rs` is named in it, and its tick order names the steps
//! `step_world` and `step_rest` (`src/world.rs`) call, in the order they call them.
//!
//! A step is a call that takes the world or the scratch as its first argument (`name(world`,
//! `name(&mut world`, `name(scratch`), a call on the scratch (`scratch.name(`), or the tick turning
//! (`world.tick += 1`). In the doc, the steps of a numbered item are the backticked names before
//! its first `: `; a path names its last part (`equipment::settle_all` is `settle_all`).

use std::path::Path;

fn read(relative: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative);
    // A Windows checkout may have CRLF line ends.
    std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{}: {e}", path.display()))
        .replace("\r\n", "\n")
}

fn doc() -> String {
    read("../../docs/architecture/sim.md")
}

const TICK_TURNS: &str = "tick += 1";

/// The body of `fn <name>(` in `source`, up to the `}` that closes it at the start of a line.
fn body_of<'s>(source: &'s str, name: &str) -> &'s str {
    let start = source.find(&format!("fn {name}(")).unwrap_or_else(|| panic!("no fn {name}"));
    let rest = &source[start..];
    let end = rest.find("\n}\n").unwrap_or_else(|| panic!("fn {name} doesn't end"));
    &rest[..end]
}

fn is_ident(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// The identifier that ends just before byte `end` of `text`.
fn ident_before(text: &str, end: usize) -> &str {
    let head = &text[..end];
    let start = head.rfind(|c: char| !is_ident(c)).map_or(0, |i| i + 1);
    &head[start..]
}

/// The steps a function body calls, in order.
fn steps_in_code(body: &str) -> Vec<String> {
    // Comments name steps too; only the code counts.
    let code: String = body
        .lines()
        .map(|line| line.find("//").map_or(line, |i| &line[..i]))
        .collect::<Vec<_>>()
        .join("\n");
    let mut steps: Vec<(usize, String)> = Vec::new();
    for (i, _) in code.match_indices('(') {
        let name = ident_before(&code, i);
        if name.is_empty() {
            continue;
        }
        let after = &code[i + 1..];
        let takes_world = ["world", "&mut world", "&world", "scratch", "&mut scratch"]
            .iter()
            .any(|w| after.starts_with(w) && !after[w.len()..].starts_with(is_ident));
        let on_scratch = code[..i - name.len()].ends_with("scratch.");
        if takes_world || on_scratch {
            steps.push((i, name.to_string()));
        }
    }
    for (i, _) in code.match_indices("world.tick += 1") {
        steps.push((i, TICK_TURNS.to_string()));
    }
    steps.sort();
    steps.into_iter().map(|(_, name)| name).collect()
}

/// The steps the doc's list under `### <heading>` names, in order.
fn steps_in_doc(doc: &str, heading: &str) -> Vec<String> {
    let marker = format!("### {heading}");
    let start = doc.find(&marker).unwrap_or_else(|| panic!("sim.md has no `{marker}`"));
    let section = &doc[start + marker.len()..];
    let section = &section[..section.find("\n#").unwrap_or(section.len())];
    // Each numbered item, with the indented lines that continue it.
    let mut items: Vec<String> = Vec::new();
    for line in section.lines() {
        let number = line
            .find(". ")
            .filter(|&dot| dot > 0 && line[..dot].chars().all(|c| c.is_ascii_digit()));
        match (number, items.last_mut()) {
            (Some(dot), _) => items.push(line[dot + 2..].to_string()),
            (None, Some(item)) if line.starts_with("   ") => {
                item.push(' ');
                item.push_str(line.trim());
            }
            _ => {}
        }
    }
    let mut steps = Vec::new();
    for item in &items {
        let head = &item[..item.find(": ").unwrap_or(item.len())];
        for (n, part) in head.split('`').enumerate() {
            if n % 2 == 1 {
                let name = part.rsplit("::").next().unwrap().trim_end_matches("()");
                steps.push(name.to_string());
            }
        }
    }
    steps
}

fn assert_same_steps(function: &str) {
    let source = read("src/world.rs");
    let code = steps_in_code(body_of(&source, function));
    let doc = steps_in_doc(&doc(), &format!("`{function}`"));
    if code != doc {
        let width = code.len().max(doc.len());
        let rows: Vec<String> = (0..width)
            .map(|i| {
                let c = code.get(i).map_or("", String::as_str);
                let d = doc.get(i).map_or("", String::as_str);
                let mark = if c == d { " " } else { "≠" };
                format!("{mark} {:>2}. code {c:<32} doc {d}", i + 1)
            })
            .collect();
        panic!(
            "docs/architecture/sim.md's tick order under `{function}` doesn't match the code; \
             name each step it calls, in order:\n{}",
            rows.join("\n")
        );
    }
}

#[test]
fn the_map_names_every_step_world_step_in_order() {
    csp_npc::install(); // T1719
    assert_same_steps("step_world");
}

#[test]
fn the_map_names_every_step_rest_step_in_order() {
    csp_npc::install(); // T1719
    assert_same_steps("step_rest");
}

#[test]
fn the_map_names_every_top_level_module() {
    csp_npc::install(); // T1719
    let doc = doc();
    let lib = read("src/lib.rs");
    let missing: Vec<&str> = lib
        .lines()
        .filter_map(|line| {
            let line = line.trim_start_matches("pub ");
            line.strip_prefix("mod ")?.strip_suffix(';')
        })
        .filter(|module| !doc.contains(&format!("`{module}`")))
        .collect();
    assert!(missing.is_empty(), "docs/architecture/sim.md doesn't name the modules {missing:?}");
}

#[test]
fn the_step_finder_sees_calls_on_the_world_and_the_scratch() {
    csp_npc::install(); // T1719
    let body = "fn f() {\n    a(world, 1);\n    // b(world)\n    crate::m::c(&mut world);\n    \
                d(worlds);\n    h(scratch);\n    scratch.e();\n    scratch.x.f();\n    world.tick += 1;\n    \
                w.g(world, s);\n}\n";
    assert_eq!(steps_in_code(body), ["a", "c", "h", "e", "tick += 1", "g"]);
}

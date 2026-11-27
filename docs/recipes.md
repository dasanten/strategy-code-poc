# Recipes

Step lists for the changes tickets make again and again (T124.3). Adding a building kind, a good,
a vessel or siege machine, or an order is in `docs/adding-content.md`; this covers the rest. Each
recipe was followed once on a throwaway branch; what the checks asked for is written in.

What a change _does_ is a rule. It is Daniel's call, and it goes into its section file of
`docs/context/` first (a new term also into `CONTEXT.md`). Its numbers are yours to pick: list
them in the PR.

Every recipe ends the same way:

1. Run `pnpm generate` when the crates changed, and commit what it writes (`packages/balance`,
   `script-data.json`, `packages/shared-types/src/generated`). It runs `pnpm types:rust`, `pnpm balance:rust` and
   `pnpm script-data:rust`, the commands the recipes below name. `pnpm check` fails on a stale one.
2. While working, run the tests of the crate you change: `cargo nextest run -p csp-sim <filter>`.
3. Before finishing, `pnpm check:rust` once and `pnpm check <base>`, and fix what they ask for.

## The checks and the tests

- `pnpm check <base>` (ADR 0013), with `<base>` the branch the change goes into
  (`origin/epic/<n>-<slug>`, or `origin/dev` for a bug): it regenerates (when the change touches
  the crates), runs lint, `pnpm knip` (no unused export, file or dependency; `knip.jsonc`),
  typecheck and only the client tests the change affects, and says what it ran. `pnpm test` is
  the client's full suite; CI runs it and `pnpm check:rust`'s steps.
- `pnpm check:rust`: fmt, clippy with warnings as errors, and `cargo nextest run`. It shares the
  machine with other sessions' checks (ADR 0040) and may say it is waiting for one.
- While working, `cargo nextest run -p csp-sim [filter]`, the crate you change: it doesn't
  rebuild `csp-server`.
- A test over 5 s is a regression to fix, not to tag.
- Each crate's integration tests build into one binary: a new file in `tests/` goes into that
  crate's `tests/all.rs` (a test fails when one is missing).
- Cargo links with `rust-lld` (`.cargo/config.toml`), so it runs from PowerShell or bash alike.
- The client's types are generated from the crates (`ts-rs`): after changing a type the client
  sees, `pnpm types:rust`, and commit `packages/shared-types/src/generated/` (a Rust test fails
  when it is stale; `docs/architecture/generated.md`).

## A missed mutant

`pnpm mutants <base>` (ADR 0048) runs `cargo mutants` on the Rust lines changed since `<base>`:
each mutant changes one line (a `<` to `<=`, a `+` to `-`, a function's body to a default value)
and runs the tests of its crate (and `csp-sim`'s for `csp-shared`). It never fails; it writes
`target/mutants/report.md` and stops at a 30 min cap (`--minutes <n>` for another). Tests,
the bench binaries, logging, messages and balance numbers are left out (`.cargo/mutants.toml`).

A missed mutant is a line whose change no test noticed. Read the line and the change:

1. **A rule no test holds**: the change would play differently (a fight lost instead of won, a good
   not consumed). Write the test that fails with the mutant, in the rule's test file, and run
   `cargo mutants -f <file> --re '<the mutant's name>'` to see it caught.
2. **A line that does nothing**: the change gives the same results, because the case cannot happen
   or another line already covers it (a `>` to `>=` where the two are never equal, a guard the
   caller already made). Simplify the line, or leave it if it reads better; no test.
3. **Only felt in time or text**: a cache, a fast path, a message. Leave it.

"Unviable" mutants did not build and say nothing; "timed out" ones made a loop never end, which a
test caught by its time limit.

## A new rule in the simulation

1. The rule, in its section file of `docs/context/`.
2. Its code in the module of its domain in `crates/csp-sim/src/`. A new module is declared in
   `crates/csp-sim/src/lib.rs`; its tests go in `<module>/tests.rs` beside it (`#[cfg(test)] mod
tests;`), as `rally.rs` and `rally/tests.rs` do.
3. If it runs every tick: its call in `step_world` or `step_rest` (`crates/csp-sim/src/world.rs`),
   at the place in the tick order that what it reads needs. The order carries behaviour: read the
   steps around the place before you pick it. A rule a resident's order carries out goes in its
   order instead (`docs/adding-content.md`: An order).
4. Its invariant (ADR 0004): see "An invariant" below. What a rule must always keep is checked
   there, not only in its tests.
5. Its tests: in the module's `tests.rs`, or for a test across modules a file in
   `crates/csp-sim/tests/`, named in that crate's `tests/all.rs` (a test fails when one is
   missing). Build its world with the helpers in `crates/csp-sim/src/test_world.rs` or
   `crates/csp-sim/tests/common/`. A test over 5 s is too slow: give it a smaller world.
6. What a script sees of it, if anything: a field in its script view (`script_tables/views/`) or a
   query (see "A script function or table entry").
7. Its wiki section in `apps/web/src/wiki/<topic>.tsx`: the prose by hand, its numbers from
   `@csp/balance`, never typed into the text. The files are named by subject (hunger is in
   `food.tsx`, walking in `transport.tsx`); `WIKI_TOPICS` in `apps/web/src/wiki/Wiki.tsx` lists
   them with their titles.
8. A rule that changes what NPC cities do: also "An NPC behaviour".
9. A rule that changes what a save holds: also "A change to the shape of the world state".

The fixture comparisons (`differential`, `npc_chain`, `npc_stepped`, `residents_stepped`,
`sight_fixtures` and the rest in `crates/csp-sim/tests/`) are frozen TypeScript output. A rule that changes what they
compare fails them: replace the failing comparison with a Rust test of the new rule, never edit a
fixture, and say so in the PR (`CLAUDE.md`: The server is Rust).

## A change to the shape of the world state

The world is never reset (ADR 0006): a save written by today's server loads into tomorrow's.

1. The type in `crates/csp-shared/src/world/` (`mod.rs` holds `WorldState`; each part has its own
   file). A new field takes `#[serde(default, skip_serializing_if = ...)]` on its empty value, as
   the fields around it do: `default` so an older save loads, `skip_serializing_if` because the
   round trips fail on a field that a save without it comes back with ("added by the round
   trip"). A field of `WorldState` itself is also set in `create_world`
   (`crates/csp-sim/src/world.rs`), which the compiler asks for.
2. Bump `WORLD_FORMAT_VERSION` in `crates/csp-shared/src/world/world_format.rs` by one. Two
   tickets on one epic each bump in turn: after merging the epic tip, bump again past it.
3. Its migration step in `migrations()` (`crates/csp-server/src/world_format.rs`), with a test
   there that a save of the old format comes out right. **Until the reset ships** (ADR 0035), a
   bump writes no migration: `RESET_FORMAT_VERSION` equals `WORLD_FORMAT_VERSION`, and
   `has_no_steps_from_before_the_reset_and_one_for_every_version_since` asks for none. The first
   bump after the reset is on `main` pins `RESET_FORMAT_VERSION` to the number it had and adds
   the first step; that test then asks for one step per version.
4. A type the client sees (it derives `TS`): `pnpm types:rust`, and commit
   `packages/shared-types/src/generated/`. A Rust test fails while it is stale.
5. Run `cargo nextest run -p csp-shared` and `cargo nextest run -p csp-server world_format`: the
   round trips (`crates/csp-shared/tests/world_round_trip.rs`) read the frozen save and the world
   fixtures with the new shape.
6. A field that a tick changes on the fixture worlds fails the differential run
   (`crates/csp-sim/tests/differential.rs`: "extra" or "missing" at some tick), a fixture
   comparison like those above: replace it with a Rust test of the rule, never edit the fixture.

## A balance number

1. One declaration, with its comment, inside the `balance!` block of its domain's file in
   `crates/csp-shared/src/balance/` (`mod.rs` lists the files; read its header). The files are
   named by domain, mostly as the section files of `docs/context/` and the modules of `csp-sim`
   are (`starting_city.rs`, `survival.rs`, `travel.rs`); the number's name is in the file. A
   number of a
   building kind, good, vessel or siege machine is a field of its spec (`building_specs.rs`,
   `good_specs.rs`, `craft_specs.rs`) instead. A number the client has no use for stands outside
   the block and says `Not exported` in its comment.
2. Read it in Rust as `csp_shared::balance::NAME`, whichever file it is in.
3. `pnpm balance:rust`, and commit `packages/balance/`: `balance.json`, `balance.d.ts` and
   `src/constants.ts` each get its line (`the_files_in_packages_balance_are_not_stale` fails
   until then). The client imports it from `@csp/balance`.
4. A changed value fails the unit tests that pin what it does (changing `NPC_JOB_MARGIN` failed
   two of `npc_scores`): read them, as they say what the number is for, and move their numbers
   with it only where the rule still holds.
5. Its wiki section shows it from `@csp/balance`: `import { NAME } from '@csp/balance'` in
   `apps/web/src/wiki/<topic>.tsx`, never the value typed into the text.
6. List it in the PR with the value picked and why.

## An invariant

1. Its check and its line in the `INVARIANTS` list of its domain's file in
   `crates/csp-sim/src/invariants/` (the header of `mod.rs` says how). Nothing else needs an
   edit: `world_invariants()` joins every domain's list. A check that needs the rule's own helpers
   can live in the rule's module and be named in the list, as `horses.rs` does.
2. A new domain is a new file, its `mod` line in `invariants/mod.rs` and its line in `DOMAINS`;
   `every_domain_file_is_joined_into_the_list` fails while one is missing.
3. A check over what a tick keeps beside the world (trades, offers, debt payments, buy-offs) is
   listed with `ledgered` and gets the ledgers through `check_with`.
4. Its tests: one that the check finds nothing on a sound world and one that it catches the broken
   case, looked up by its name with `invariant_named` (as in
   `crates/csp-sim/tests/invariants_rules.rs`) or in `crates/csp-sim/tests/invariants.rs`.
   `hold_on_a_fresh_world_and_after_many_ticks` runs every invariant over 200 ticks of a starting
   city: a new one that breaks it there is wrong, or the rule is.
5. How it runs: the server checks every invariant each tick in development and a share of them
   (`INVARIANT_SAMPLE_RATE`, `LIVE_INVARIANT_SAMPLE_RATE` in `crates/csp-server/src/config.rs`)
   live, and reports a violation to Sentry (`crates/csp-server/src/monitoring.rs`), grouped by the
   invariant's name. A violation crashes nothing.

## A script function or table entry

Everything a script reads or asks for goes through the game API (ADR 0002). The tables are in
`crates/csp-sim/src/script_tables/`, one module per table.

- **A query** (a script asks, nothing changes): its `ScriptBinding` in
  `script_tables/api/queries.rs` (name, params, cost, description, what it returns), and in
  `script_tables/army_api.rs` too if an army's script gets it. Its arm in `query` in
  `crates/csp-sim/src/script_bindings.rs`, which reads only what the Player sees. Its call in
  `describe_every_field_of_everything_the_queries_and_me_hand_a_script`
  (`script_bindings/tests.rs`): the test fails on a binding it doesn't call. What it returns is a
  script view; a new view or field goes in `script_tables/views/<domain>.rs`.
- **A value** (read like a variable: `tick`, `mapSize`): `script_tables/api/values.rs`, its value
  in `global_value` (`script_bindings.rs`).
- **An action that asks for an order:** its `ScriptAction` beside the order's `OrderMeta`
  (`docs/adding-content.md`: An order). One that asks for none: `script_tables/api/control.rs`.
- **A default script:** its file in `script_tables/default_scripts/`, its line in
  `DEFAULT_SCRIPTS` (`script_tables/default_scripts.rs`) in the order of `TASKS`. The wiki shows
  it as it is.
- **What a param accepts:** `script_tables/param_descriptions.rs`.

Then `pnpm script-data:rust`, and commit `packages/lang-wasm/script-data.json`
(`script_data_json_is_not_stale` fails until then). The
editor's completions, the checker and the wiki's game API section read it: the wiki test
(`apps/web/src/wiki/wiki-scripting.test.ts`) asks for every binding and view field there, so
they need no hand-written text, but a binding's `description` is what the Player reads.

## A query the client needs

The client calls the game's own Rust rules as WebAssembly, never a TypeScript copy (ADR 0045;
`docs/wasm-rules.md` says how it fits together and what the mirror doesn't know).

1. The rule in Rust, in `crates/csp-sim/src/queries/` (the module of its domain), so the server
   and the client share one function.
2. Into the module (`crates/csp-lang-wasm/src/`), by what it reads:
   - **values only** (costs, prices, names, checks of what is sent): one arm in `rule` in
     `value_rules.rs`, and one function in `packages/lang-wasm/src/rules.ts` that calls
     `rule('<name>', ...)`;
   - **the world in sight:** a method of `WorldMirror` in `rules.rs` (`#[wasm_bindgen(js_name =
...)]`), called on the client through `worldMirror()` (`apps/web/src/world/world-mirror.ts`);
     and its line in `crates/csp-sim/tests/mirror_parity.rs`, which asks it of the full world and
     of each realm's mirror. If it reads what no Player is sent, it answers otherwise there: name
     it in `DIFFERS` with what the mirror answers, and in the table of `docs/wasm-rules.md`;
   - **a check of whether something is allowed** that reads the world: one arm in
     `world_rules.rs`, one function in `apps/web/src/world/world-rules.ts`.
3. The call on the client, from the view model that needs it (the `*-view.ts` beside its panel).
   ESLint's `csp/no-rule-copy` refuses a client function named after a `queries/` function: call
   the module. A rule asked per frame or per tile may stay a TypeScript twin instead
   (`docs/wasm-rules.md`: The TypeScript twins), held to its original by
   `crates/csp-sim/tests/client_twins.rs` and `apps/web/src/world/client-twins.test.ts`.
4. A Vitest test of the call (`apps/web/src/world/wasm-rules.test.ts` for a value rule, the view's
   own test otherwise). `pnpm test` and `pnpm typecheck` build the module first
   (`pnpm wasm:build`); it fails on code that reaches the clock, threads or files.
5. The module's size: `docs/wasm-rules.md` keeps it under 500 kB gzipped and records each change.
   A large rule says its size in the PR.

What the server must send for it is a separate change: what a Player is sent is cut down in
`crates/csp-sim/src/sight.rs` (`SeenBuilding`, `SeenResident` and the rest in
`crates/csp-shared/src/world/protocol.rs`), then `pnpm types:rust`.

## An NPC behaviour

NPC cities only give their residents orders, which request actions as a Player's do (ADR 0002;
`docs/context/npc-cities.md`, `docs/context/npc-stances.md`).

1. The rule in its section file.
2. Where it goes:
   - a job an adult could take: the planning pass (`npc_plan.rs`, once a game hour, ADR 0016) and
     its score in `npc_scores.rs` (ADR 0029, 0039), with its weights in
     `crates/csp-shared/src/balance/npc_planning.rs`;
   - what the city does between passes, or the orders it hands out: `npc_behaviour.rs`;
   - a behaviour of its own (stances, threat, hunts, demands, founding, scouts, traders): its
     `npc_<name>.rs` module, called from the NPC phase of `step_world` (`world.rs`) or from
     `step_rest` (stances, threat, demands);
   - an order it gives that a Player's residents can't be given yet: an order first
     (`docs/adding-content.md`), with `npc_city` set in its `OrderMeta`; an NPC resident holding
     any other order breaks an invariant.
3. Its invariant in `crates/csp-sim/src/invariants/npc_cities.rs` (or `npc_fighting.rs`,
   `npc_founding.rs`), and its tests in the module's own `tests.rs` on a world from
   `crates/csp-sim/src/npc_test_world.rs`.
4. The fixture comparisons of NPC cities (`npc_chain`, `npc_stepped`, `npc_founded`,
   `residents_stepped` in `crates/csp-sim/tests/`) fail when the behaviour changes what they
   compare: replace the comparison with a Rust test, never edit the fixture.
5. The slow simulations in `crates/csp-sim/src/npc_slow/` run game days or weeks of NPC cities.
   Most are `#[ignore]`d with their time; run them with `pnpm test:slow` (all but the year run,
   several minutes on an idle machine), or one by name:
   `cargo nextest run --cargo-profile slow --profile slow -p csp-sim --lib --run-ignored only -E
"test(/npc_slow::surplus::/)"`. Run the ones for what you changed before the PR, and say which
   in it. The coordinator runs `pnpm test:slow` before an epic goes into `dev`, as epics interact
   through NPC behaviour. The year run (`pnpm test:year`) is a nightly report, not a check.

## A panel or map layer on the client

The client is in `apps/web/src/`, one folder per area (`residents/`, `city/`, `army/`,
`diplomacy/`, `trade/`, `transport/`, `realm/`, ...). The screen's frame is in `screen/`, the map
in `map/` (ADR 0044: the layout; `docs/context/screen.md`: its terms). `docs/architecture/client.md`
says what each folder holds and how the world reaches the screen.

**A panel:**

1. Its component `<Name>.tsx` in its area's folder, with what it shows worked out in a
   `<name>-view.ts` beside it and tested in `<name>-view.test.ts` (the tests run in Node: keep
   React out of the view).
2. Where it opens: a sidebar tab is one line in `SIDE_TABS` (`screen/hud-view.ts`) and its
   `sideTab(...)` in `screen/GameSidebar.tsx`. Typecheck then asks for its icon in `TAB_ICONS`
   (`ui/ui-icons.ts`), and `screen/hud-view.test.ts` for its place in the strip; nothing asks for
   the `sideTab(...)`, so check that it shows.
   A tab of the resident card is one in `CARD_TABS` (`residents/residents-view.ts`; ADR 0012);
   an order panel above the command bar, `screen/order-panel-view.ts` and
   `screen/CommandBar.tsx`. Its CSS goes in the `styles/` file of its area.
3. Its look from `ui/Kit.tsx`, `ui/panel-head.tsx` and the theme (`ui/theme.ts`; ADR 0044: Pixel
   frontier), goods through `ui/GoodsGrid.tsx`, icons through `ui/Icon.tsx`.
4. What it needs of the world comes from `useWorld` (`world/useWorld.ts`); rules from
   `@csp/lang-wasm` (see "A query the client needs"); numbers from `@csp/balance`; types from
   `@csp/shared-types`.

**A map layer:**

1. What it needs of the world in `MapWorld` (`map/map-world.ts`, filled in `GameMap.tsx`).
2. What it draws in a file of its own in `map/` (`map/plans.ts` and `map/places.ts` are small
   examples): a pure function that works out what to draw, tested in `map/<name>.test.ts`, and one
   that draws it onto a Pixi `Graphics` with the camera (`map/camera.ts`).
3. Its call in `draw` or `drawOverlay` in `screen/MapView.tsx`: onto `under` (below the tokens: grid,
   city areas, roads) or `overlay` (above them), or a container of its own added to the stage in
   its order (`app.stage.addChild(...)`). Colours from `map/palette.ts`.
4. If it shows at some zoom tiers only, ask `zoomTier` (ADR 0008); if the legend names it,
   `map/legend.ts`. Typecheck and the tests ask for none of this: the layer is only seen in the
   browser.

Then `pnpm check <base>` runs lint, typecheck and the tests your change affects. A change you can
see goes into the browser before the PR: run the app on a copy of a world (`world.db` copied to a
scratch `DB_PATH`, a `.claude/launch.json` entry on free ports), since a fresh world takes over
half an hour to generate.

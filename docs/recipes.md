# Recipes

Step lists for the changes tickets make again and again (T124.3). Adding a building kind, a good,
a vessel or siege machine, or an order is in `docs/adding-content.md`; this covers the rest. Each
recipe was followed once on a throwaway branch; what the checks asked for is written in.

What a change *does* is a rule. It is Daniel's call, and it goes into its section file of
`docs/context/` first (a new term also into `CONTEXT.md`). Its numbers are yours to pick: list
them in the PR.

Every recipe ends the same way:

1. Run `pnpm generate` when the crates changed, and commit what it writes (`packages/balance`,
   `script-data.json`, `packages/shared-types/src/generated`). `pnpm check` fails on a stale one.
2. While working, run the tests of the crate you change: `cargo nextest run -p csp-sim <filter>`.
3. Before finishing, `pnpm check:rust` once and `pnpm check <base>`, and fix what they ask for.

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
   `@csp/balance`, never typed into the text.
8. A rule that changes what NPC cities do: also "An NPC behaviour".
9. A rule that changes what a save holds: also "A change to the shape of the world state".

The fixture comparisons (`npc_chain`, `npc_stepped`, `residents_stepped`, `sight_fixtures` and
the rest in `crates/csp-sim/tests/`) are frozen TypeScript output. A rule that changes what they
compare fails them: replace the failing comparison with a Rust test of the new rule, never edit a
fixture, and say so in the PR (`CLAUDE.md`: The server is Rust).

## A change to the shape of the world state

The world is never reset (ADR 0006): a save written by today's server loads into tomorrow's.

1. The type in `crates/csp-shared/src/world/` (`mod.rs` holds `WorldState`; each part has its own
   file). A new field takes `#[serde(default)]` unless every save must already hold it.
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

## A balance number

1. One declaration, with its comment, inside the `balance!` block of its domain's file in
   `crates/csp-shared/src/balance/` (`mod.rs` lists the files; read its header). A number of a
   building kind, good, vessel or siege machine is a field of its spec (`building_specs.rs`,
   `good_specs.rs`, `craft_specs.rs`) instead. A number the client has no use for stands outside
   the block and says `Not exported` in its comment.
2. Read it in Rust as `csp_shared::balance::NAME`, whichever file it is in.
3. `pnpm balance:rust`, and commit `packages/balance/`: `balance.json`, `balance.d.ts` and
   `src/constants.ts` each get its line. The client imports it from `@csp/balance`.
4. Its wiki section shows it from `@csp/balance`: `import { NAME } from '@csp/balance'` in
   `apps/web/src/wiki/<topic>.tsx`, never the value typed into the text.
5. List it in the PR with the value picked and why.

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

Then `pnpm script-data:rust`, and commit `packages/lang-wasm/script-data.json`. The
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
in `map/` (ADR 0044: the layout; `docs/context/screen.md`: its terms).

**A panel:**

1. Its component `<Name>.tsx` in its area's folder, with what it shows worked out in a
   `<name>-view.ts` beside it and tested in `<name>-view.test.ts` (the tests run in Node: keep
   React out of the view).
2. Where it opens: a sidebar tab is one line in `SIDE_TABS` (`screen/hud-view.ts`) and its
   `sideTab(...)` in `screen/GameSidebar.tsx`; typecheck asks for nothing more, so check it shows.
   A card or its tab goes in `screen/SelectionCard.tsx` and `screen/selection-view.ts`
   (ADR 0012).
3. Its look from `ui/Kit.tsx`, `ui/panel-head.tsx` and the theme (`ui/theme.ts`; ADR 0044: Pixel
   frontier), goods through `ui/GoodsGrid.tsx`, icons through `ui/Icon.tsx`.
4. What it needs of the world comes from `useWorld` (`world/useWorld.ts`); rules from
   `@csp/lang-wasm` (see "A query the client needs"); numbers from `@csp/balance`; types from
   `@csp/shared-types`.

**A map layer:**

1. What it draws in a file of its own in `map/` (`map/plans.ts` and `map/places.ts` are small
   examples): a pure function that works out what to draw, tested in `map/<name>.test.ts`, and one
   that draws it onto a Pixi `Graphics` with the camera (`map/camera.ts`).
2. Its call in the frame's draw in `screen/MapView.tsx`: onto `under` (below the tokens: grid,
   city areas, roads) or `overlay` (above them), or a container of its own added to the stage in
   its order (`app.stage.addChild(...)`). Colours from `map/palette.ts`.
3. If it shows at some zoom tiers only, say which (`map/levels.ts`); if the legend names it,
   `map/legend.ts`.

Then `pnpm check <base>` runs lint, typecheck and the tests your change affects. A change you can
see goes into the browser before the PR: run the app on a copy of a world (`world.db` copied to a
scratch `DB_PATH`, a `.claude/launch.json` entry on free ports), since a fresh world takes over
half an hour to generate.

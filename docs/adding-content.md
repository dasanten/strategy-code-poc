# Adding content

How to add a building kind, a good, a vessel or siege machine, and an order (Epic 121). Each kind
of content has one place where it is defined. The compiler, the typechecker and the tests ask for
the rest. The steps below come from a trial of each, made on a throwaway branch (T121.9, #1577).

What a new kind *does* is a rule. It is Daniel's call, and it goes into its section file of
`docs/context/` first (a new term also goes into `CONTEXT.md`). Its numbers are yours to pick
(`CLAUDE.md`: Balance numbers): list them in the PR.

Every recipe ends the same way:

1. Run `pnpm generate`, and commit what it writes (`packages/balance`, `script-data.json`,
   `packages/shared-types/src/generated`).
2. Run `pnpm check:rust` and `pnpm check <base>`, and fix what they ask for.
3. A kind that is added needs no `WORLD_FORMAT_VERSION` bump: old saves load as they are. Renaming
   or removing one does need a bump (ADR 0006).

## A building kind

1. `crates/csp-shared/src/world/buildings.rs`: its name in `BuildingKind`. The string is its
   name in saves, in the protocol and on the client.
2. `crates/csp-shared/src/balance/building_specs.rs`: its arm in `spec()` and its
   `BuildingSpec` block. The block holds the label, purpose, footprint, where it stands, how it
   is built (Build menu group and place, materials, work), what working there takes (workers,
   skill, wreck worth, recipes, batches), housing and decay. A fact that doesn't apply is `None`.
   The balance tables, the Build menu, the membership lists and the client's specs are all made
   from this block.
3. The client's art, which typecheck asks for: `BUILDING_ART` (`apps/web/src/map/art.ts`) and
   `BUILDING_COLORS` (`map/palette.ts`).
4. The pixel art, which the art tests ask for: `BUILDING_SLICE` (`map/pixel-art.ts`). A real slice
   comes from `art/pixel` (`scripts/pixel-art.mjs`); until then point it at a similar building's.
   `PAINTED_BUILDING_ART` is optional: a kind left out falls back to its glyph.

What the checks don't ask for, because it is a rule or prose:

- Whether NPC cities build it. Today they build only what `npc_chain.rs` and the city layouts
  name. A layout puts any other kind in its workshop quarter (`city_layout.rs`: `quarter_of`), and
  only the kinds in `STREET_SIDE` get a street.
- Its section of the wiki (`apps/web/src/wiki/`). The tables of buildings render from the specs;
  the prose about it doesn't.

Trial: a Kiln (wood into coal), 5 files edited by hand and 4 regenerated. The epic measured
15–18 before (#1568).

## A good

1. `crates/csp-shared/src/world/goods.rs`: its name in `Good`, and in `PricedGood` too if it has
   a price. A good with a price that is missing from `PricedGood` does not compile. So does a
   weapon missing from `Weapon`.
2. `crates/csp-shared/src/balance/good_specs.rs`: its arm in `spec()` and its `GoodSpec` block:
   label, the script stock view's text, weight, warehouse floor, base price, what it is as gear,
   and wear. The goods lists, the balance tables and the script stock view's field are made from
   it.
3. The client's art: `GOOD_ART` (`apps/web/src/ui/goods-grid.ts`), which typecheck asks for. Its
   icon file in `apps/web/src/assets/goods/` and its slice in `PIXEL_GOOD` (`map/pixel-art.ts`),
   which the tests ask for.
4. Where it comes from (a recipe in a building's block, a node) and who uses it. These are rules.

A good with a price changes the economy: warehouses keep a floor of it, and NPC cities may find
themselves short of it. The fixture comparisons that this changes (`npc_chain`, `sight_fixtures`,
`residents_stepped`) then fail. They are frozen TypeScript output: never edit a fixture. Replace
the failing comparison with a Rust test of the new rule, and say so in the PR (`CLAUDE.md`: The
server is Rust).

Trial: Rope, 5 files edited by hand (one of them an icon file) and 6 regenerated. The epic
measured 12–15 before. The trial also failed 3 fixture comparisons, for the reason above.

## A vessel or siege machine

It is a building kind, its site, plus a kind of its own that the site becomes.

1. The site: steps 1 and 2 of a building kind. It stands by `Stands::OwnRule` and shares a tile
   (`shares_a_tile: true`), as the ram's and catapult's blocks do.
2. `crates/csp-shared/src/world/vessels.rs`: its name in `VesselKind` or `SiegeMachineKind`.
3. `crates/csp-shared/src/balance/craft_specs.rs`: its arm in `spec()` and its `VesselSpec` or
   `SiegeMachineSpec` block, `built_as` naming its site. A finished site becomes the craft, and
   the client's site rules and cards follow, all through `built_as` (`SIEGE_SITES` on the
   client).
4. The client's art, which typecheck and the tests ask for: `BUILDING_ART` and `UNIT_ART`
   (`map/art.ts`), `BUILDING_COLORS`, `UnitToken` and `UNIT_SIZE` (`map/units.ts`), and its
   sprite in the Build menu (`UNIT_KINDS` in `build-menu-view.ts`). The Build menu test lists the
   Siege group's kinds and asks for the new one.
5. What it does (a ram's strike, a catapult's throw, a ship's sailing) is an order of its own:
   see below.

Trial: a Ballista, 9 files edited by hand and 5 regenerated. Before the epic the vessel and
machine tables were also typed into the client by hand (Ram: 65 files touched). The trial found
four places on the client that named the ram and catapult by hand and so would have passed over
a third machine without an error. They now read `MACHINE_SPECS` (T121.9).

## An order

1. `crates/csp-shared/src/world/orders.rs`: its struct, and its variant in `ResidentOrder` if a
   resident holds it while it runs. Only requests like `mount`, `buy` or `load` don't need a
   variant.
2. Its module in `crates/csp-sim/src/` (declared in `lib.rs`), which holds:
   - its `OrderKind`, which checks and applies a request;
   - its `OrderMeta`: the kind string and flags (queue step and its group, gets off first, adults
     only, keeps the script, NPC cities give it, ...);
   - its `ScriptAction`, if a script can ask for it (`script_actions.rs`): its arguments, how
     each becomes a field, and its description. Its entry in the game API and its binding are
     made from that. An action whose arguments aren't simply the order's fields is bound by hand
     in `script_bindings/irregular.rs`, with its reason;
   - its `RunningOrder` impl, if it has a variant (`running.rs`). The compiler asks for each
     method: its path, pace and target, its arrival, how it resumes, what it ties its resident
     to.
3. Name it in `ORDER_METAS` (`order_meta.rs`). If it has a variant, also name it in both
   `running_orders!` lists (`order_meta.rs`, `running.rs`): the compiler asks for those. A meta
   left out of `ORDER_METAS` is dead code, which clippy rejects; a running order missing from it
   fails `a_running_orders_kind_is_the_one_in_the_save`.
4. The client, which typecheck asks for: its doing text (`ORDER_DOING`, `Residents.tsx`), and,
   for an order that goes along a path, `MOVES_NOW` (`map/motion.ts`).
5. A queue step, which the tests ask for: its plan step (`PlanStepId`, `PLAN_STEPS` and the
   `planOrder` case in `plan-step.ts`) and its queue row text (`stepLabel` in `queue-view.ts`).
6. Its own picks on the map, previews and availability on cards (`App.tsx`, `pick-mode.ts`,
   `pick-preview.ts`, `selection-view.ts`), if it has any. This is real per-order behaviour and
   stays hand-written.
7. Run `pnpm script-data:rust`. A new script action adds an entry to `script-data.json`.

Trial: Stroll, a walk with a `stroll(x, y)` action, 9 files edited by hand (one of them new)
and 4 regenerated. The epic measured about 25 before (Sail: 15 in the sim, 10 on the client).

## Left over

Each of these is a place that only knowing would find, and each is left as it is:

- **NPC use of a new building kind or good:** the NPC chain, city layouts and trade name what
  they use by hand. Whether NPCs use a new kind is a rule, not a list to keep in step.
- **The client's switches over plan steps and queue rows** (`planOrder`, `stepLabel`) are
  `switch`es, not one record per order as T121.8 meant. The tests do catch an order that is
  missing from them, as long as it is a queue step.
- **Prose:** `docs/context/`, `CONTEXT.md` and the wiki's text are written by hand, as they
  should be.

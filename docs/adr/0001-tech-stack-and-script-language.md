# Tech stack and script language

Status: decided (2026-10-17, with Daniel). Partly superseded, see below.

> **Precedence (2026-10-18):** where this document conflicts with the game vision captured in
> `CONTEXT.md` and later ADRs, the vision wins. In particular the map size and shape (decision 9
> and the 32×24 grid in code) are replaced by the world-map decisions, and "unit" is replaced by
> the domain terms in `CONTEXT.md`. Control is hybrid (ADR 0002), not script-only.

## Product decisions

| #   | Decision                                                                                                 | Why                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Scripts run in a **tick loop**: each unit's script runs once per tick with a step budget (Screeps-style) | It's deterministic and fair, and it is the core loop of the game                                                                |
| 2   | One **persistent world** that runs around the clock, not separate matches                                | That's the game we want. It means world state and scripts have to be stored durably, and the simulation runs with nobody online |
| 3   | **TypeScript** on both server and client                                                                 | One language, and the game API and protocol types are shared                                                                    |
| 4   | **Our own script language** with its own interpreter                                                     | Step counting and the budget are built in, scripts can reach only the game API, and there's no sandbox to escape                |
| 5   | **JavaScript-like syntax** with braces                                                                   | It looks familiar to players and is simple to parse                                                                             |
| 6   | **1 tick per second**                                                                                    | Scripts get a generous budget, and the world still feels alive                                                                  |
| 7   | **Up to about 50 players on one server**                                                                 | No sharding. A single process holds the whole world in memory                                                                   |
| 8   | **Units keep a small `memory` object** between ticks                                                     | Scripts can carry plans and roles across ticks. It's size-capped and saved with the world                                       |
| 9   | **2D top-down tile grid** in the browser                                                                 | Cheap to build, and it's all the PoC needs                                                                                      |

## Tech stack

**Repo layout:** a pnpm workspace monorepo with four packages:

- `packages/lang`: the lexer, parser and interpreter
- `packages/shared`: game types, the game API definitions and the wire protocol
- `apps/server`
- `apps/web`

The client imports `lang` too, so the editor shows exactly the same syntax errors the server would.

**Server**

- Node.js (current LTS) with Fastify for HTTP: login, saving scripts and loading the initial world.
- WebSocket using the `ws` package, which pushes each tick's world changes to connected clients.
- The simulation is one authoritative loop that holds the world in memory. Each tick runs every unit's script, collects the actions they request, then resolves those actions together, so the order units run in never matters (the Screeps model).
- Scripts run in the main process at first, which is fine at 50 players, 1 tick per second and a step budget. The interpreter is pure and has no I/O, so it can move to `worker_threads` later without changes.

**Storage**

- SQLite through `better-sqlite3` and the Drizzle ORM. It needs no setup and is durable, which suits a single server.
- Tables: users, scripts (with version history), and world snapshots plus each unit's memory, written every N ticks and on shutdown.
- If we ever need more than one server, we swap in Postgres through Drizzle.

**Client**

- Vite and React for the UI: script editor, unit inspector and logs.
- PixiJS for the tile map.
- CodeMirror 6 for the editor, with a highlighting mode for our language and inline errors from `packages/lang`. It's lighter than Monaco and easier to extend.

**Tooling**

- Vitest for tests. The interpreter in particular gets thorough tests.
- ESLint and Prettier.

**Hosting (PoC):** a single container with a persistent volume for the SQLite file, for example on Fly.io or a small VM.

## Script language design

**Implementation:** a hand-written lexer and a recursive-descent parser produce a syntax tree, which a tree-walking interpreter runs. Writing it by hand rather than using a parser generator like Chevrotain or Ohm gives us full control over error messages and keeps everything in one package.

**Version 1 features**

- `let`, `if`/`else`, `while`, `for (x of list)`, `fn` functions with `return`
- Numbers, strings, booleans, `null`, lists and objects
- Comments

There are no classes, modules, async or exceptions in version 1.

**Budget**

- Every evaluated node costs 1 step, and game API calls cost more.
- A script that runs out of budget is stopped for that tick. The actions it already requested still count, and the player sees a warning.
- There's also a cap on how deep function calls can nest.

**Game API:** scripts get only these built-in globals:

- `me`: the unit, read-only
- `memory`: read and write
- `world`: queries such as `world.nearest("enemy")` and `world.at(x, y)`
- Actions such as `move(dir)`, `attack(target)`, `gather(target)` and `say(text)`. Actions only request things, and the simulation resolves them after every script has run.

**Example**

```
if (memory.role == null) { memory.role = "gatherer" }

let enemy = world.nearest("enemy")
if (enemy != null && distance(me, enemy) < 3) {
  attack(enemy)
} else {
  move(towards(world.nearest("resource")))
}
```

## Glossary

- **Tick:** one step of the simulation, one per second. Each tick runs every script, resolves all actions, then broadcasts the changes.
- **Step budget:** the maximum number of interpreter steps one unit's script may use per tick.
- **Action:** a request a script makes (move, attack and so on) that is resolved at the end of the tick.
- **Memory:** a small, size-capped object per unit that is saved between ticks and with the world.

## Deferred

- How to balance step costs
- How players get new units
- Map generation
- Authentication beyond a username and session
- How scripts and units are assigned to each other (one script per unit type, or per unit)

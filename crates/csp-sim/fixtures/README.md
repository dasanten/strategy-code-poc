# Fixtures from the frozen TypeScript game

Golden files written by `scripts/dump-fixtures.mts` from the TypeScript game at the feature
freeze (ADR 0030). Rust tests compare against them: bit for bit for terrain, nodes, random numbers,
hashes and paths, as parsed JSON for worlds. Nothing here is edited by hand; a fixture changes only
when the script runs again. Files over about 5 MB are in `.gitignore` and marked "not in git"
below; regenerate them (and everything else) from the repo root with

```bash
corepack pnpm exec tsx --conditions=source scripts/dump-fixtures.mts --full --db <path to world.db>
```

`--full` adds the hash of the full-size map, which takes minutes; `--db` takes the live save from
a server's database (any worktree's `apps/server/data/world.db`; the script works on a copy).
Without them those files are left as they are.

Conventions:

- `.bin` files are `TerrainMap.tiles`, one byte per tile, row by row (`y * size + x`).
- World files are `{ terrain: { size, tiles: <base64> }, world: <JSON.stringify(world)> }`, so a
  Rust test needs nothing else.
- `worlds/*.sight.json` is `entitiesInSight` of that world for every realm and city, by id;
  `sight/*.json` are `{ size, world, sight }`, the same for the worlds `sight.test.ts` starts
  from (sight needs only the map's size).
- Numbers JSON cannot hold are written `{"$number": "NaN" | "Infinity" | "-Infinity" | "-0"}`.
- Stepped worlds use a `Walking` whose path searches always finish within the tick (budget
  `Infinity` instead of `PATH_BUDGET_MS`), so where people stand never depends on the machine.
- Path requests run in order, one `PathFinder` per walls/roads setting, each kept across its
  requests; `walls` is the `WallMap` (tiles and the inside they enclose), `roads` tile indices.
- Language cases come from the string arguments of the lang tests' helpers (`value(e)` runs
  `out(e)`), and from `DEFAULT_SCRIPTS` (checked, not run: they need the game API). Test cases
  run with only `out` and the budget in `budget`; `envs` holds the checker's names and shapes.
- `save/live.json.gz` is a real world loaded the way the server starts (migrated to the current
  format), gzipped as `saveWorld` writes it; `save/live.json` says which save it was.

| File | Made by |
| --- | --- |
| `balance.json` | every exported constant of packages/shared/src/balance.ts; `csp-shared`'s `balance::tests` compare the Rust table with it, every constant present on both sides |
| `lang/cases.json` | tokenize, parse, checkScript, checkNames and run for every script in the lang tests and DEFAULT_SCRIPTS |
| `nodes/1-256.json` | placeResourceNodes(generateTerrain(1, 256), 1) |
| `nodes/1-512.json` | placeResourceNodes(generateTerrain(1, 512), 1) |
| `nodes/1-64.json` | placeResourceNodes(generateTerrain(1, 64), 1) |
| `nodes/42-256.json` | placeResourceNodes(generateTerrain(42, 256), 42) |
| `nodes/7-1024.json` | placeResourceNodes(generateTerrain(7, 1024), 7) |
| `paths/requests.json` | PathFinder(generateTerrain(1, 512)).findPath for 200 requests, one finder per walls/roads setting |
| `random/hash.json` | hash(x, y, seed) of terrain-gen.ts, for 500 triples |
| `random/mulberry32--5.json` | mulberry32(-5), its first 2,000 values |
| `random/mulberry32-1.json` | mulberry32(1), its first 2,000 values |
| `random/mulberry32-2147483647.json` | mulberry32(2147483647), its first 2,000 values |
| `random/mulberry32-31.json` | mulberry32(31), its first 2,000 values |
| `random/mulberry32-7.json` | mulberry32(7), its first 2,000 values |
| `random/name-hash.json` | hash(text) of residents.ts (FNV-1a), for ids, names and non-ASCII text |
| `save/live.json` | the live save’s tick, its format version, and the version its row was saved with |
| `save/live.json.gz` | loadOrCreateWorld(db) then gzip(JSON.stringify(world)), as saveWorld stores it |
| `save/version.json` | WORLD_FORMAT_VERSION of world-format.ts |
| `sight/city.json` | createWorld(cityTerrain()) and foundStartingCity for players 1 to 1, with entitiesInSight for every realm and city |
| `sight/three-realms.json` | createWorld(cityTerrain()) and foundStartingCity for players 1 to 3, with entitiesInSight for every realm and city |
| `sight/two-realms.json` | createWorld(cityTerrain()) and foundStartingCity for players 1 to 2, with entitiesInSight for every realm and city |
| `sight/visitors.json` | Player 1 visiting NPC cities and the Trade Org HQ on Plains (dumpVisitors), with entitiesInSight for every realm and city |
| `terrain/1-256.bin` | generateTerrain(1, 256).tiles |
| `terrain/1-512.bin` | generateTerrain(1, 512).tiles |
| `terrain/1-5760.sha256` | sha256 of generateTerrain(1, 5760).tiles (--full) |
| `terrain/1-64.bin` | generateTerrain(1, 64).tiles |
| `terrain/42-256.bin` | generateTerrain(42, 256).tiles |
| `terrain/7-1024.bin` | generateTerrain(7, 1024).tiles |
| `trade/deliveries.json` | setup() of deliveries.fixture.ts |
| `trade/transfers.json` | setup() of transfers.fixture.ts |
| `worlds/generated-1-1024.json` | generateWorld(generateTerrain(1, 1024), 1) |
| `worlds/generated-1-2880.json` | generateWorld(generateTerrain(1, 2880), 1) (not in git) |
| `worlds/hq-0.json` | hq() of trade-org.test.ts, then 0 × stepWorld(world, terrain, walking) with an unhurried Walking |
| `worlds/hq-1.json` | hq() of trade-org.test.ts, then 1 × stepWorld(world, terrain, walking) with an unhurried Walking |
| `worlds/hq-10080.json` | hq() of trade-org.test.ts, then 10080 × stepWorld(world, terrain, walking) with an unhurried Walking |
| `worlds/hq-1440.json` | hq() of trade-org.test.ts, then 1440 × stepWorld(world, terrain, walking) with an unhurried Walking |
| `worlds/hq-1440.sight.json` | entitiesInSight for every realm and city of hq() of trade-org.test.ts, then 1440 × stepWorld(world, terrain, walking) with an unhurried Walking |
| `worlds/hq-60.json` | hq() of trade-org.test.ts, then 60 × stepWorld(world, terrain, walking) with an unhurried Walking |
| `worlds/hq-60.sight.json` | entitiesInSight for every realm and city of hq() of trade-org.test.ts, then 60 × stepWorld(world, terrain, walking) with an unhurried Walking |
| `worlds/village-0.json` | village() of npc-growth.fixture.ts, then 0 × stepWorld(world, terrain, walking) with an unhurried Walking |
| `worlds/village-1.json` | village() of npc-growth.fixture.ts, then 1 × stepWorld(world, terrain, walking) with an unhurried Walking |
| `worlds/village-10080.json` | village() of npc-growth.fixture.ts, then 10080 × stepWorld(world, terrain, walking) with an unhurried Walking |
| `worlds/village-1440.json` | village() of npc-growth.fixture.ts, then 1440 × stepWorld(world, terrain, walking) with an unhurried Walking |
| `worlds/village-1440.sight.json` | entitiesInSight for every realm and city of village() of npc-growth.fixture.ts, then 1440 × stepWorld(world, terrain, walking) with an unhurried Walking |
| `worlds/village-60.json` | village() of npc-growth.fixture.ts, then 60 × stepWorld(world, terrain, walking) with an unhurried Walking |
| `worlds/village-60.sight.json` | entitiesInSight for every realm and city of village() of npc-growth.fixture.ts, then 60 × stepWorld(world, terrain, walking) with an unhurried Walking |

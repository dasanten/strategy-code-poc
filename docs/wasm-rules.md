# The rules as WebAssembly

The client calls the game's Rust rules, compiled to WebAssembly, instead of a TypeScript copy
(ADR 0045, Epic 122). They live in `crates/csp-lang-wasm` beside the script checker, and the client
reaches them through `@csp/lang-wasm` (`packages/lang-wasm/src/index.ts`).

## How it fits together

- `crates/csp-lang-wasm/src/value_rules.rs` (T122.5): the rules that take only values (costs,
  recipes, prices, fees, loads, names, checks of what a Player sends), all behind one entry,
  `rule(name, args)`: the arguments go in as a JSON array, the answer comes back as JSON. A rule is
  one arm there, calling `csp-sim`'s own function, and one function in
  `packages/lang-wasm/src/rules.ts`, which the client imports. A call that doesn't fit its Rust
  function throws: that is a bug in `rules.ts`.
- `crates/csp-lang-wasm/src/rules.rs`: the world mirror and the rules that read it.
- **The world mirror** (`WorldMirror`, around `csp_sim::mirror::SightMirror`) holds what the
  client sees in the module's memory, as a `WorldState` the rules read as the server's world. The
  client (`apps/web/src/world-mirror.ts`, fed by `useWorld`) hands it the server's `welcome`
  message once and each `tick` message after it, as the JSON text the socket brought; nothing
  crosses back but answers. Rules that read the world are its methods, called with ids and
  coordinates. Everything in sight is kept in place in its list, found by id, in the server's order,
  so a tick costs what it changed.
- `pnpm wasm:build` (`scripts/wasm-build.mjs`) builds the module into
  `packages/lang-wasm/generated/`. The client awaits `loadLang()` before its first render
  (`apps/web/src/main.tsx`), since the rules are called as it renders; in Node and Vitest it loads
  as `@csp/lang-wasm` is imported.

## What the browser lacks

On `wasm32-unknown-unknown` the standard library builds `Instant::now()`, `SystemTime::now()`,
threads and files as calls that only fail when they run. `pnpm wasm:build` fails when the module
holds one of their messages ("time not implemented on this platform", "operation not supported on
this platform", "failed to spawn thread"). The linker drops code nothing calls, so a message there
is one the rules can reach. In `csp-sim` the tick timers, the pathfinder's budget, the NPC planner's
timers, world generation and `npc_slow` use them: keep the rules the client calls off those paths,
or pass the clock in.

## Size

What costs bytes in the module:

- **Deserializing a type costs its code.** Deserializing a whole `WorldState` (from JSON, even an
  empty one) adds about 300 KB gzipped; build a world with `WorldState::default()` and deserialize
  only the parts a rule reads.
- **The name section** was half the module's bytes. The build removes it
  (`--remove-name-section`, also in the `Dockerfile`).
- **`wasm-opt -Oz`** (binaryen, #1637) takes nearly a quarter off the raw module and 49 KB off the
  gzipped one. The local build runs it from the pinned `binaryen` dev dependency, the `Dockerfile`
  from the same version's release; other flags (`--converge`, `--gufa`) save 1–2 KB more, `-O3`
  is 2 KB bigger.

## What the mirror doesn't know

The server sends a Player what is in their sight (`sight.rs`), and less of some of it. The mirror
fills the rest with defaults (`csp_sim::mirror`):

| Not sent                                                                                      | The mirror holds                                                        |
| :-------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------- |
| A stranger's health and hunger, and until when they are Down                                  | full health, fed; Down without an end (`DOWN_UNTIL_UNSEEN`)             |
| A horse's health and hunger, unless the Player's                                              | the same                                                                |
| What is in a building, carriage or vessel not seen inside                                     | empty                                                                   |
| A script's memory and log, since when it waits, an army's script but its id                   | empty, waiting since 0                                                  |
| A caravan's or trader's stop, plan, load and job                                              | at its storage, with nothing to do                                      |
| Whether an order holds against blows, the Alarm a defence script interrupted                  | none                                                                    |
| Realms, events, crimes, contracts, standings, demands, Last seen and the rest of `WorldState` | none at all                                                             |
| A carried Direct offer, which stands at no storage                                            | none (offers at a storage in sight come with it: `SeenBuilding.offers`) |

So a rule that reads one of them answers on the mirror as if it were so. The parity test
(`crates/csp-sim/tests/mirror_parity.rs`) asks each rule it covers on the fixture worlds, for each
realm, of the full world and of a mirror of what that realm is sent with every tile in sight, and
fails on a rule that answers otherwise unless it is named there. Named so far, by what they read,
with what the client shows in that case today: where its TypeScript copy reads the same Seen data,
the same; for most of the rest it shows the server's answer, sent with the city, building or in
`diplomacy`:

| Rule                                                                                     | On the mirror                                                         | The client today                                           |
| :--------------------------------------------------------------------------------------- | :-------------------------------------------------------------------- | :--------------------------------------------------------- |
| **Realms** (`world.realms`: none)                                                        |                                                                       |                                                            |
| `realmName`, `organizationLabel`                                                         | any realm is "a fallen realm"                                         | its own realm's name from `home`, others' from `diplomacy` |
| `realmsKnownTo`                                                                          | no realm                                                              | `diplomacy.knownRealms` from the server                    |
| `realmsToOfferTo`                                                                        | no realm                                                              | `diplomacy.directOfferRealms` from the server              |
| `realmsStandingTogether`                                                                 | no realm                                                              | no view asks it                                            |
| `directOfferProblem`, `carriedOfferProblem`                                              | to any realm: "send a direct offer to a realm"                        | no view asks them; the server checks the order             |
| `transferProblem`, `pickUpTransferProblem`, `handInProblem`                              | any city: "not a city of a realm"                                     | no view asks them; the server checks the order             |
| **Standings** (`world.standings`: none, so each is 0)                                    |                                                                       |                                                            |
| `standingOf`, `standingSwing`                                                            | 0                                                                     | no view asks them                                          |
| `standingsFor`                                                                           | none                                                                  | `diplomacy.standings` from the server                      |
| `npcCityRefuses`                                                                         | no NPC city refuses anyone                                            | `SeenCity.refuses` from the server                         |
| `sellsTo`                                                                                | every NPC city for sale sells                                         | `SeenCity.wontSell` from the server                        |
| `cityPrice`                                                                              | the price at standing 0                                               | `SeenCity.price` from the server                           |
| `npcHirePrice`                                                                           | the price at standing 0                                               | `SeenCity.hire` from the server                            |
| `shutOut`, `wallsKey`, `wallMap`                                                         | no city shuts its gates to anyone                                     | no view asks them                                          |
| `buyProblem`, `npcTradeProblem`, `swapProblem`, `buyHorseProblem`, `npcHorseSaleProblem` | never "won't trade with you" (or "too low standing"): the next reason | no view asks them; the server checks the order             |
| **Standings and stock not seen inside**                                                  |                                                                       |                                                            |
| `npcCityPrices`                                                                          | prices at standing 0, on no stock                                     | `SeenCity.trade` from the server                           |
| `npcHorseOffers`, `horsesToSell`                                                         | prices at standing 0; the city has no Coins to buy a horse            | `SeenCity.horses`, `SeenCity.horsesToSell` from the server |
| `npcHorsePurchaseProblem`                                                                | never "won't trade with you"; "hasn't the coins"                      | no view asks it; the server checks the order               |
| **Resource nodes** (`world.nodes`: none)                                                 |                                                                       |                                                            |
| `nodeCorner`                                                                             | no node workplace goes anywhere                                       | the same rule on the nodes the Player explored             |

The test asks 234 rules, every world-reading twin of the client's rules that `csp-sim` holds;
a rule not named here answers on the mirror as on the full world, on these fixtures. The
fixtures hold no alliances, contracts, demands, crimes, directives, debts, armies, vessels,
caravans or traders, so the rules that read those agree there without showing that the mirror
holds them: on a world with them, any rule that reads realms, standings, contracts, alliances,
or demands reads none on the mirror. Those come in their own messages (`diplomacy` and the
rest) and are not mirrored yet.

## Measurements (T122.1)

On a copy of the live world (save format 148, 5760 × 5760 map), with the messages one Player's
socket got over 30 ticks: `bench-broadcast` wrote them (`BENCH_DUMP=<folder> DB_PATH=<copy>
cargo run --release -p csp-server --bin bench-broadcast -- save 1 30`), and
`node scripts/wasm-rules-bench.mjs <folder>` measured them, in Node 22 on the Ryzen 9 7900X. The
`welcome` message is 4.4 MB with 4,949 things in sight (4,450 buildings) and 38,905 remembered;
a `tick` message is about 277 KB, with 416 things changed on average.

| What                                              |  Limit |                                                                                    Measured |
| :------------------------------------------------ | -----: | ------------------------------------------------------------------------------------------: |
| Added to what the browser downloads, compressed   | 500 kB |            388 KB gzipped as served for the whole module (today's checker alone was 464 KB) |
| Start: load the module and mirror the first world | 150 ms |                        47 ms (module 2.4 ms, first mirror 45 ms); 73 ms in the browser pane |
| Mirror update per tick                            |   4 ms |                       2.8 ms mean, 3.4 ms p95; 3.45 ms mean, 3.9 ms p95 in the browser pane |
| One rule call (`buildingAt`)                      |   1 ms | 0.002 ms mean; 0.2 ms the first call after an update, which builds the lookup by tile again |

How each was taken:

- **Download:** the module the browser fetches (`csp_lang_wasm_bg.wasm`), gzipped at level 6 as
  `tower-http` serves it (`app.rs`). It is 1,072 KB raw. Counted whole, since once rules move the
  client loads it at start, where today only the script editor loads it. Removing the TypeScript
  copy will take its share off the client's bundle.
- **Start:** compiling and instantiating the module, then the first mirror of the `welcome`.
  Mirroring Last seen too (43,304 buildings, 7.1 MB) would take about 120 ms.
- **Update:** `WorldMirror::tick` with each message's text. Most of it is reading the JSON: the
  client parses the same text for itself, so there is room in giving the mirror less to read.
- **Rule call:** `buildingAt` on and around every building in sight.

The update is the tightest of the four: T122.4's mirror reads more than buildings, so it should
keep a tick's cost to what the tick changed, as this one does, and measure again.

## Size after T122.5

The value rules add about 15 KB gzipped: the module is 402 KB gzipped (1,139 KB raw), from 388 KB.

## Measurements (T122.4: the whole mirror)

The same messages and machine as above, with the mirror holding everything in sight and the value
rules of T122.5 in the module, over three runs while other sessions built on the machine:

| What                         |  Limit |                                             Measured |
| :--------------------------- | -----: | ---------------------------------------------------: |
| Added download, compressed   | 500 kB |              485 KB gzipped as served (1,484 KB raw) |
| Start                        | 150 ms |      48–51 ms (module 2.9 ms, first mirror 45–48 ms) |
| Mirror update per tick       |   4 ms |  **4.2–4.5 ms mean**, 4.8–5.7 ms p95: over the limit |
| One rule call (`buildingAt`) |   1 ms | 0.002 ms mean; 0.2 ms the first call after an update |

What it took to get there:

- **Each thing in sight is read straight into its type.** `SeenEntity` is an internally tagged
  enum: serde buffers each entity before reading it, which costs twice the time, and from that
  buffer a map with number keys (a script's params by script id) doesn't read at all. The mirror
  reads the `is` the server writes first and the rest straight into that kind's type
  (`seen_entity_raw` in `rules.rs`).
- **`ResidentOrder` reads tag first** (`tag_first!` in `orders.rs`), on the server too. In the
  module it has no fallback for an order whose `kind` comes later (the server never writes one):
  the fallback read every order a second way and cost 23 KB gzipped.
- Tried and dropped: `opt-level = 3` for `serde_json` and `csp-shared` in the wasm profile (no
  faster, 14 KB bigger), `float_roundtrip` off (0.3 ms faster, but it changes how every number
  the server reads is rounded).

The update is over its limit, and the download is close to its own. A tick of this world changes
about 400 residents, who move: reading their JSON is most of the update. The options (fewer fields
per moving resident in a tick, `wasm-opt`, a binary tick message, other limits) are Daniel's
call, in #1637.

## Size after the first part of T122.5b

The rules on a few fields of one thing (`ageInYears` to `isParamChoice`, #1634) add about 10 KB
gzipped: the module is 495 KB gzipped (1,528 KB raw), from 485 KB, 5 KB under the limit. The
rest of #1634 does not fit until #1637 is decided.

## Size after the second part of T122.5b

The rules on one building, resident or horse (`materialsNeeded` to `feedProblem`, #1634) take
the thing whole and read it the way the mirror does (`SeenBuilding`, `SeenResident`, `SeenHorse`
and `csp_sim::mirror::{resident, horse}`). The module is 541 KB gzipped (1,727 KB raw) with #1586, from
495 KB: over the 500 kB limit, which waits on #1637. The mirror's update is not touched (only
`resident` and `horse` in `mirror.rs` became public), so its time stays as measured in T122.4.

## Size after the third part of T122.5b

The rules on one contract, realm, directive or carriage, `workPace` and the rename problems
(#1634) add readers for `MercenaryContract`, `Realm`, `Directive` and `SeenCarriage`: the module is
557 KB gzipped (1,792 KB raw), from 541 KB. The mirror's update is not touched.

## Size after the fourth part of T122.5b

`workingOn`, the trade holders and quotes, the city rules and the queue step rules (#1634) add
readers for `City`, `Offer` and `OrderRequest`: the module is 570 KB gzipped (1,850 KB raw), from
557 KB. The mirror's update is not touched.

## Size after the last part of T122.5b

`cutSwap`, `traderPrices`, `traderEscortsWanted`, `horsesIn` and `keptBreeding` (#1634): the
module is 574 KB gzipped (1,868 KB raw), from 570 KB. The mirror's update is not touched.

## The checks on the world (T122.6)

The checks that say whether something is allowed and why not, and read the world, are asked of
the mirror: one entry, `WorldMirror.rule(name, args)` (`crates/csp-lang-wasm/src/world_rules.rs`),
and `rules(calls)` for many in one call, which a card asks for each resident on a tile. The client
calls them through `apps/web/src/world-rules.ts` by ids and coordinates; until a welcome went in,
nothing is refused (the server checks the order). Something not in the mirror (gone in the
message the client hasn't shown yet) gets the check's own "no such …".

| Check                                                                   | What goes in besides ids                                                                              |
| :---------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| `buildProblem` (of a material too), `nodeCorner`                        | the explored terrain and nodes around the footprint, as a patch: the mirror holds no terrain or nodes |
| `driveOffProblem`, `hitchOffProblem`, `horseToSteal`, `mountOffProblem` | the realm                                                                                             |
| `rowOffProblem`, `boardVesselProblem`                                   | the realm; as crew                                                                                    |
| `breedProblem`, `keptPair`                                              | the horses' owner                                                                                     |
| `handOverProblem`, `heirProblem`                                        | who serves others, from `diplomacy`: the alliance's army, the realm's contracts and whether started   |

What the client knows besides the mirror goes into its world for that one call and out again
(`SightMirror::with_known`). The rest of the client's world-reading checks were asked by no view
(trade, the horse market, transfers, offers, demands, debts, renaming): they are gone, and the
server checks those orders. `relocateProblem` stays in TypeScript: it reads the cities and
buildings the Player remembers out of sight (Last seen), which the mirror doesn't hold, so on the
mirror every city out of sight would read as none of the realm's.

The module is 584 KB gzipped (1,903 KB raw) after merging the epic tip with the last of #1634; these checks added 10 KB of it (542 to 552 KB before that merge). On a mirror of 4,450 buildings and 500
residents in Node: `buildProblem` 0.28 ms for a house (its city area), 0.01 ms for a town hall,
2 ms the first call after an update (the lookup by tile built again); a Build menu's 22 kinds
0.4 ms; a tile's 5 thieves in one call 0.05 ms.

## Measurements after `wasm-opt` (#1637)

Binaryen's `wasm-opt -Oz` (version 132) on the module as #1585 left it, with the same messages and
machine as T122.1 (`node scripts/wasm-rules-bench.mjs`, Node 22), the module without and with
`wasm-opt` measured in turn, three times each, while other sessions built on the machine:

| What                         |  Limit |                                        Before (#1585) |                                     With `wasm-opt -Oz` |
| :--------------------------- | -----: | ----------------------------------------------------: | ------------------------------------------------------: |
| Added download, compressed   | 500 kB |               586 KB gzipped as served (1,903 KB raw) | **537 KB** gzipped as served (1,472 KB raw): 37 KB over |
| Start                        | 150 ms |                          45–49 ms (module 2.8–3.7 ms) |                            47–49 ms (module 2.2–2.4 ms) |
| Mirror update per tick       |   4 ms |                     3.83–4.31 ms mean, 4.1–5.3 ms p95 |                       3.62–3.79 ms mean, 4.0–4.6 ms p95 |
| One rule call (`buildingAt`) |   1 ms | 0.002 ms mean; 0.15–0.20 ms the first after an update |   0.002 ms mean; 0.13–0.14 ms the first after an update |

The download is still over its limit, by 37 KB. The update's mean is under 4 ms in Node, by about
0.2–0.4 ms; its p95 is not, and T122.1 measured the browser pane about 0.65 ms slower than Node.
Daniel raised the download limit to 550 kB on 2026-11-26 (#1637), so 537 KB is inside it. The
tables above keep the 500 kB that held when they were measured.

## Way estimates, reach and the rest of the map (T122.8, #1641)

What #1586 left in `apps/web/src/shared/`, each given what it reads with the call (Daniel's
decision on #1641), so nothing new is mirrored:

| Rule                                                                              | Now                                                                                                                                                                                                                                                                              |
| :-------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `arrivalTicks` (`wayTicks` in it)                                                 | `WorldMirror.arrivalTicks(id, order, ground)` (`crates/csp-lang-wasm/src/estimate_rules.rs`): the resident, their horse and carriage from the mirror, the ground of the way's tiles as one `Uint8Array`; one call per way. The route preview passes the way it draws as `order`. |
| `cityMembership` (the far map's city sizes), with the reach it asks per pair      | `cityMembership(buildings, cityIds, halls, size)` (`area_rules.rs`): every building in one typed array, one call per fill of the far map's cache                                                                                                                                 |
| `nearFootprint`, `footprintsNear`, `gapTo`                                        | gone from the client: only `cityMembership` asked them                                                                                                                                                                                                                           |
| `wallMap`, `shutOut` and the wall steps                                           | gone from the client: no view asked them (only a test did); the server decides who steps where                                                                                                                                                                                   |
| `allied`, `alliedRealms`, `commanderOf`, `defendsCity`, `occupierOf` and the rest | gone from the client: no view asked them. Shared sight (`sharingSight`) had already gone; the server sends what an alliance sees                                                                                                                                                 |
| `previewPath` (`apps/web/src/map/path-preview.ts`)                                | stays in TypeScript, as it runs as the pointer moves; `path-preview-parity.test.ts` holds it to the Rust pathfinder's fixture (`fixtures/paths/requests.json`)                                                                                                                   |

The text of estimates (`aboutTime`, `timeLeft`, `workLeft` and the countdowns) stays with the
client: it words a number, and `csp-sim` has no twin of it.

The parity test already asks the mirror `arrivalTicks` (on Plains everywhere, as the fixtures hold
no terrain), `cityMembership`, `allied`, `alliedRealms` and `wallMap`; nothing is added there.

What changed in behaviour:

- **Which orders get an estimate** is the server's (`Going::estimated` while it goes now): the same
  kinds as the TypeScript (walking, relocating, driving, a haul route while driving, a store or fetch
  order while it walks to its place).
- **A resident not in the mirror** (in no `welcome` yet, or gone in a message the client hasn't
  shown) has no estimate; the TypeScript estimated anyone the client's world held.
- **A construction site of no city** went to the area rules as city 999, a finished building of a
  city the client never named (`-1 + SITE`); it is a site of no city now.

The module is 591 KB gzipped (1,919 KB raw), from 584 KB.

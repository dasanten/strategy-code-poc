# The client and the server's edge

The client is a React app drawn with Pixi (`apps/web`, built with Vite). It holds no rules of its
own: the types, the numbers and the rules come from the Rust crates, generated
(`docs/architecture/generated.md`) or compiled to WebAssembly (`docs/wasm-rules.md`).

## How a part is written

Most parts are three files: a component (`Thing.tsx`), the words and choices it shows as plain
functions (`thing-view.ts`) and their test (`thing-view.test.ts`, Vitest in Node; a component is
tested only where its markup matters, with `renderToStaticMarkup`). Hooks that hold a part's state are `useThing.ts`. A part reads the world as
`ClientWorld` (`apps/web/src/world/useWorld.ts`), the types from `@csp/shared-types`, the numbers
and specs from `@csp/balance` and the rules from `@csp/lang-wasm`; it never types one of them again
(ESLint's `csp/no-rule-copy`, `docs/wasm-rules.md`).

## The folders of `apps/web/src`

At the top: `main.tsx` loads the rules module, then renders `App.tsx`, which shows the Wiki, the
pixel kit, the login, the admin page or the game, and whose `Game` wires the parts of the game
screen together. `env.d.ts` declares Vite's imports.

| Folder | What belongs in it |
| --- | --- |
| `world/` | What the client knows of the world: `useWorld` (the socket and `ClientWorld`), `api.ts` (the HTTP calls), `useLand`, the rules module's mirror (`world-mirror.ts`) and checks (`world-rules.ts`), the TypeScript twins of Rust rules (`world.ts`, `terrain.ts`, `client-twins.test.ts`), frame reading (`socket-frames.ts`), the casts of balance numbers (`narrowed.ts`), `test-mirror.ts` for tests |
| `screen/` | The game screen's frame: the HUD and top bar, the sidebar and its tabs (`SIDE_TABS` in `hud-view.ts`), the command bar and order panels, the selection card, the dock, notices, phone sheets (`sheet-view.ts`), login, the page routing (`pages.ts`), `MapView.tsx` (the Pixi map) and `game-wiring.ts` (what `Game` hands the parts) |
| `map/` | Everything the map draws and how: camera, zoom tiers, gestures, terrain chunks and their caches, tokens, figures, roads, walls, labels, pins, the minimap, the legend, the art (SVG, painted and pixel) and `GameMap.tsx`, which puts `MapView` on the screen |
| `pick/` | Pick mode (ADR 0012, `CONTEXT.md`: Picking a target): what waits for a tile (`pick-mode.ts`), its preview (`pick-preview.ts`), `usePick` and the banner |
| `residents/` | The residents list, the resident and group cards (`CARD_TABS`, `GROUP_TABS` in `residents-view.ts`), their orders (`useResidentOrders`, `useGroupOrders`), what a resident is doing, equipment, estimates, persuasion, relocating, saved groups |
| `army/` | Armies and the army card |
| `building/` | Building info and orders, the build menu, work settings, footprints, decay, patches, walls, last-seen buildings |
| `city/` | The cities tab and the city inspector |
| `realm/` | The realm: founding, realm orders and their cards, waypoints, the realm log, who is online, control mode, the first day, Zeal |
| `diplomacy/` | The Diplomacy tab: standing, alliance, contracts, demands, direct offers, temperament |
| `trade/` | Warehouse offers, swaps, transfers, caravans |
| `transport/` | Horses, carriages, vessels and their orders |
| `queue/` | The queue planner: steps, blocks, conditions, saved queues, the clipboard |
| `script/` | The script workshop: the editor, the library, params and the start form, runs, memory, the log |
| `creative/` | Creative mode's bar and sections (ADR 0043) |
| `admin/` | The admin page: its map, inspector, jump list, directives, tick health |
| `wiki/` | The Wiki: `Wiki.tsx` lists the topics (`WIKI_TOPICS`), one file per topic, `wiki-view.ts` the numbers it works out, `wiki-scripting.ts` the script examples a test checks |
| `ui/` | Shared atoms: the kit (`Kit.tsx`, ADR 0044), icons, the goods grid, panel heads, the theme |
| `styles/` | The CSS, one file per area of the screen |
| `assets/` | Images: `goods`, `map` and `ui` (SVG), `painted`, and `pixel` (written by `pnpm art:pixel`) |

## How the world reaches the screen

1. **The socket.** `useWorld` opens the WebSocket (`WS_PATH`), reads each frame in arrival order
   (`socket-frames.ts`: large messages are gzipped binary frames, ADR 0034) and turns the
   `welcome` and each `tick` into a new `ClientWorld`: the map, the explored chunks and what is in
   sight, with what changed and what left applied.
2. **The mirror.** The same message text goes, once, into the rules module's mirror
   (`feedMirror` in `world-mirror.ts`), where `csp-sim`'s own rules read it by ids and
   coordinates. Checks of what is allowed (`world-rules.ts`) are asked there, so the client's
   refusal is the server's; until the mirror has a world nothing is refused.
3. **`Game`** in `App.tsx` gives each part's hook what it needs of `ClientWorld` and of the others
   (`game-wiring.ts`); orders go back through `sendOrder` (the `order` message) and HTTP calls
   through `api.ts`.
4. **The map.** `GameMap.tsx` hands `MapView.tsx` a `MapWorld` (`map/map-world.ts`). `MapView`
   draws on request, one frame at a time: terrain, coarse terrain zoomed out, territory, then the
   overlay (structures, units, paths, marks), the labels and the minimap.

The map's terrain is loaded apart from the socket, and kept in three caches (ADR 0034):

- `map/chunks.ts` (`ChunkStore`): the chunks in memory, asked for in batches
  (`TERRAIN_BATCH_PATH`), the nearest first, at the level the zoom draws (`map/levels.ts`);
- `map/terrain-cache.ts`: explored terrain kept in the browser between visits, keyed by each
  chunk's count of explored tiles, so an unchanged chunk needs no request; it is never the truth;
- `map/shown-textures.ts`: the chunk textures painted, at most `KEPT_TEXTURES`, a frame's painting
  time capped; `map/terrain-layer.ts` and `map/coarse-layer.ts` draw them.

The land (regions, passes, land bridges) comes from `LAND_PATH` through `useLand`.

## Where a new thing goes

- **A panel.** Its component, view and test in the folder of its area. A sidebar tab: an entry in
  `SIDE_TABS` (`screen/hud-view.ts`) and its body in `screen/GameSidebar.tsx`. A tab of the
  resident card: `CARD_TABS` in `residents/residents-view.ts`. An order's panel above the command
  bar: `screen/order-panel-view.ts` (its size) and `screen/CommandBar.tsx`. Its CSS in the
  `styles/` file of its area, from the kit's atoms (`ui/Kit.tsx`).
- **A pick mode.** A case of `PickTarget` in `pick/pick-mode.ts`, what a tile does in `usePick`,
  its preview in `pick/pick-preview.ts` and its banner text in `PickBanner.tsx`; the order that
  starts it in the part that gives it.
- **A wiki section.** A file `wiki/<id>.tsx` and a line in `WIKI_TOPICS` (`wiki/Wiki.tsx`).
  Numbers come from `@csp/balance` (worked out in `wiki-view.ts`), never typed into the text.
- **A map layer.** What it needs of the world in `MapWorld` (`map/map-world.ts`, filled in
  `GameMap.tsx`), its geometry and choices as a tested module in `map/`, and its drawing as a
  `draw…` function in `screen/MapView.tsx`, called from `draw` or `drawOverlay` at the zoom tiers
  it shows in (`zoomTier`, ADR 0008).

## How the server serves the client

The server is `crates/csp-server`: the HTTP side in `app.rs` (axum), the WebSocket side in
`realtime.rs`, the game thread in `server.rs`.

- **The messages.** `crates/csp-server/src/wire.rs` describes them as types for the client
  (`ServerMessage`: `founding`, `welcome`, `tick`, `scriptMemory`, `scriptRun`, `scriptLog`,
  `firstDay`, `ack`, `rejected`; `ClientMessage`: `order`, `found`, `watch`). `realtime.rs` builds
  the same JSON, so a change to a message is made in both. `PROTOCOL_VERSION` tells an old tab the
  game was updated.
- **Where sight is cut down.** `crates/csp-sim/src/sight.rs` decides what a realm sees
  (`CONTEXT.md`: Sight): `entities_in_sight` for the `welcome`, what changed and what left for each
  `tick`, made on the game thread in `Realtime::broadcast_tick`. `crates/csp-server/src/sync.rs`
  keeps what each connection was sent, so a tick sends only the difference. Terrain and land
  routes in `app.rs` answer only explored terrain (`explored_id`, `explored.rs`,
  `crates/csp-sim/src/queries/player_land.rs`).
- **Where a request is checked.** The socket tasks check only what needs no world: the origin, the
  session, the connection cap, the message allowance. Everything else runs on the game thread
  between ticks: an `order` goes to `OrderQueue::receive` (`crates/csp-sim/src/orders.rs`), which
  rejects a malformed or unknown order, then asks the order kind's `validate` with who sent it
  (`order_sender.rs`); an accepted order waits for the next tick. HTTP routes are checked by the
  middleware in `app.rs` (who is logged in, `find_user`; rate limits on logins and script writes)
  and in each handler, which asks `User::logged_in` or `User::admin`.

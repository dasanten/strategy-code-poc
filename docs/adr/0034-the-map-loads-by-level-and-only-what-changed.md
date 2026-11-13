# The map loads by level, compressed, and only what changed

Status: decided (2026-11-12, with Daniel). Changes the Sync decision of ADR 0006 (explored terrain
"in 32×32 chunks over HTTP", in batches since T84.6); the rest of ADR 0006 stands. The rule is in
`CONTEXT.md` under **Explored terrain**; built in Epic 99 (Faster map loading).

A Player who has explored much of the map waits a long time for it, and what the server sends them
grows with everything they have ever seen. With the minimap open, or zoomed all the way out, the
client asks for every explored chunk at full detail and paints a texture for each. The chunks
travel uncompressed, nothing is kept between visits, and Last seen and the Region map are compared
or sent in full. None of the decisions below changes a rule: what a Player knows, sees and
remembers stays as it is.

## Decisions

- **Coarse levels.** Explored terrain is served at full detail (level 0: one byte a tile, in
  32 × 32 chunks) and at levels 1 to 5, where one byte stands for a square of 2^k × 2^k tiles and
  a chunk is 32 × 32 squares. The map draws the level that fits the zoom and the minimap the level
  that fits its frame, so a view costs about the same whatever the zoom and however much is
  explored. Nothing loads every explored chunk any more.
- **A coarse square shows only what the Player explored of it:** the most common terrain among
  their explored tiles in the square, and unexplored only when they explored none. So ADR 0006's
  promise holds at every level: the client never holds more than the Player knows.
- **The server compresses what it sends.** HTTP responses are compressed by the server itself, and
  large WebSocket messages go out gzipped as binary frames. Neither relies on the proxy.
- **A protocol version.** A client says which protocol version it speaks when it connects; one
  older than the server can serve is told to reload. Message shapes can then change without
  breaking a tab that was open across a deploy.
- **Only what changed.** Last seen costs a tick the work of what changed, not of everything a
  Player remembers. The Region map travels per chunk as runs of one holder, and after the first
  copy only the chunks where it changed.
- **Kept in the browser.** The browser keeps the explored terrain it loaded, by Player, level and
  chunk, with the count of explored tiles it was loaded at. Terrain never changes and explored
  terrain only grows, so the same count is the same bytes. It is a cache: cleared on logout, and
  the map loads without it.
- **Not on the game thread.** Terrain is read under the explored terrain's own lock on an HTTP
  worker, not as a job between ticks.

## Alternatives

- **A coarse square shows the whole square's most common terrain** once any tile of it is explored.
  One overview shared by all Players and masked for each: simpler and a little cheaper. But it
  hints at terrain up to 31 tiles beyond what a Player saw, and Daniel chose not to.
- **Compression in Caddy.** One line in the Caddyfile, but its default list of types to compress
  has no binary types, a development server has no Caddy, and no test would notice it missing
  (T84.6 assumed chunks were already compressed there).
- **A terrain format of our own** (runs, or a palette per chunk as Minecraft's): gzip on the plain
  bytes is already smaller (the whole map: 0.45 MB gzipped, 0.70 MB as runs, 1.38 MB as palettes).
- **WebSocket permessage-deflate:** the server's WebSocket library does not have it, and it costs
  memory per connection.
- **Loading Last seen by area,** like terrain. The client lists everything a Player knows in
  several places (the minimap's dots, the far tier's emblems and roads, the planner), so it would
  need all of it anyway.
- **Explored terrain stored per chunk** instead of one 4 MB bitmap per Player. It would cut the
  memory per Player to a few KB, but saving the bitmap costs only 6 ms and 72 KB of write-ahead
  log per exploring Player (SQLite rewrites only the pages that changed), so it waits until Player
  numbers make 4 MB each matter. It needs a table migration with a test.
- **Drawing terrain in a shader** from the terrain bytes instead of painted textures: the largest
  cut in client memory, and a rewrite of the map's painted look (ADR 0008). Not needed once
  textures are painted only when shown.
- **Making terrain in the browser from the seed:** ADR 0006 already rules it out, as it would leak
  unexplored land.

## Measurements

Before, on 2026-11-12, on a copy of a worked dev world (5,760 tiles across, 34 cities, 4,649
buildings, tick 870), with Node's zlib and SQLite and the client's own code on the dev machine.
The live game was not measured: `csp-admin map-stats` (T99.1) prints the same for any world.

| What                                            | Measured                                                                                            |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| The whole map at full detail                    | 32,400 chunks, 507 batch requests, 32 MB; 0.45 MB gzipped or zstd-compressed                        |
| A batch of 64 chunks                            | 64.5 KB; 1.0 KB gzipped (0.7 ms) or zstd-compressed (0.35 ms); 0.7 KB with brotli                   |
| Chunks of a single terrain                      | 69%                                                                                                 |
| The whole map at level 3 (8 × 8 tiles a byte)   | 506 KB; 27 KB gzipped                                                                               |
| The whole map at level 5 (32 × 32 tiles a byte) | 32 KB; 4 KB gzipped                                                                                 |
| Painting one chunk's texture (`terrainPixels`)  | 1.1 ms and 64 KB: 5,000 chunks take 5.5 s and 313 MB, the whole map 36 s and 2 GB                   |
| Last seen                                       | about 96 bytes of JSON an entry; 0.43 MB for every building of that world                           |
| Region map                                      | about 25 KB of JSON for a village, up to 0.85 MB for all 34 cities, 260 KB for a city at full reach |
| A Player's explored terrain                     | a 4 MB bitmap whatever they explored; one Player's 31 chunks gzip to 4.8 KB                         |
| Saving one exploring Player's bitmap            | 6 ms and 72 KB of write-ahead log with one walking scout, 728 KB with ten scouts apart              |

T84.6 measured the client at about 1.4 ms a chunk for its texture, and 4.3 s to load 2,997 chunks
in batches on one machine without a network.

Each ticket of Epic 99 adds its before and after below.

### T99.1: the staged Player (2026-11-12)

`csp-admin map-stats` on a copy of the dev world the numbers above were measured on, for its
Player `havencheck`, before and after `csp-admin explore havencheck --all --yes` (release build,
the dev machine). Every later ticket compares with "after". `explore` adds no Last seen: that
Player remembers nothing out of sight either way.

| What                        | Before                    | After `explore --all`             |
| --------------------------- | ------------------------- | --------------------------------- |
| Explored                    | 16,867 tiles in 31 chunks | 33,177,600 tiles in 32,400 chunks |
| Region map                  | 1 holder, 5,013 tiles     | 18 holders, 294,966 tiles         |
| Welcome                     | 58.0 KB, 11.2 KB gzipped  | 2.78 MB, 577 KB gzipped           |
| Welcome: `exploredChunks`   | 156 B                     | 183 KB                            |
| Welcome: `entities`         | 16.5 KB                   | 16.5 KB                           |
| Welcome: `lastSeen`         | 2 B                       | 2 B                               |
| Welcome: `region`           | 40.2 KB                   | 2.58 MB                           |
| Welcome: the rest           | 1.1 KB                    | 1.1 KB                            |
| `map-stats` / `explore` run | 0.3 s                     | 2.3 s; `explore --all` 1.8 s      |

### T99.2: terrain responses travel compressed

Measured on 2026-11-12 through the server's own router (`CompressionLayer` at its default levels),
on the full map generated from seed 1 with one Player who explored all of it, asking for every chunk
in batches of 64. Not checked in a browser's Network tab.

| What                         | Before (uncompressed) | After, gzip         | After, zstd         |
| ---------------------------- | --------------------- | ------------------- | ------------------- |
| The whole map at full detail | 32,400 chunks, 32 MB  | 0.43 MB (77 times smaller) | 0.45 MB (75 times smaller) |
| A batch of 64 chunks         | 64.5 KB               | 0.7 KB              | 0.8 KB              |

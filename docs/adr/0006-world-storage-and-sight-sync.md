# World storage, migrations and per-Player sync

Status: decided (2026-10-18, with Daniel). Replaces the storage and map parts of ADR 0001.

## Decisions

- **Scale:** a tile is about 40 m and takes an unloaded resident ~30 s on plains, so the map is
  1,440 × 1,440 tiles (~2.1 million tiles), joined at opposite sides (a torus; `CONTEXT.md`: Map).
- **Terrain** is generated once from the seed when a world is created and stored as a binary blob
  (one byte per tile) in SQLite. The server keeps it in memory; roads change it in place. Later
  changes to the generator never reshape an existing world.
- **Everything else** (residents, buildings, goods, …) lives in memory and is saved as a
  compressed JSON **snapshot** every 30 ticks and on shutdown. Old snapshots are pruned: the last
  20 are kept, plus one per game day for a week. A crash loses at most 30 s. Accounts, sessions,
  invite codes and scripts are ordinary tables.
- **Migrations, always:** the snapshot carries a format version. Changing the shape of world state
  ships a migration function from the previous version, with a test. The world is never reset by
  a deploy. Schema changes to tables use Drizzle migrations as before.
- **Sync:** the server sends each client only what its Player can see (`CONTEXT.md`, Sight). On
  connect it sends everything in sight; each tick it sends the entities in sight that changed and
  the ids that left sight, as JSON. Explored terrain is loaded in 32×32 chunks over HTTP.
- **Orders** travel over the same WebSocket with a request id. The server checks them, answers
  with an ack or an error and applies them from the next tick (ADR 0002).

## Why

At 1.6 million tiles, the old approach (the whole world, tiles included, as one JSON row every 10
ticks, never pruned) would grow the database without limit and send the whole map to every
client. Generating terrain on the client would leak unexplored land, so terrain comes from the
server too. Rolling snapshots keep every new rule cheap to add, where a table per entity type
would need schema and dirty-tracking work on every slice. Daniel chose migrations over resets so
the world is persistent from the start, accepting the extra work per change.

## Consequences

- Every change to world state types needs a migration and a test.
- The per-Player view built for sync is the same view scripts will query later.
- Sending only what's in sight means the client can never show more than the Player knows.

## Exception: the one reset (2026-10-18)

The map changed from a disc to a torus before anyone played for real. Daniel chose to reset the
world once instead of migrating it: terrain, world saves and explored terrain were deleted, while
accounts, sessions, invite codes and scripts were kept, and every Player got a new starting city
on their next login. From then on the rule above holds again: no resets, migrations only.

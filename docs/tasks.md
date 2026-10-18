# Backlog

Work top to bottom. **Priority rule:** always take the next slice that makes the game playable
sooner. The order is: survive → produce → transport → grow → trade → fight → alliances → scripts.

**PoC done** = slices 0–6: my residents mine iron far away, and a carriage brings it home while
I sleep.

## Rules for every task

- Use the terms in `CONTEXT.md`. If a rule is missing or unclear, decide it with Daniel and add it
  there first.
- Keep scripting cheap to add (ADR 0002): actions and queries go through the game API, orders
  only request actions, order state is plain serialisable data.
- Every new simulation rule comes with its invariants (ADR 0004) and tests.
- Each slice ends visible in the browser. Tick the checkboxes, move the slice to Done.

## Now

### 0. Project setup

- [x] Push to GitHub (`origin` = dasanten/strategy-code-poc)
- [x] CI on GitHub Actions: lint, typecheck, test on every push
- [ ] **Daniel:** create a Sentry project (server + browser), put the DSN in `.env`
- [x] Sentry SDK on server and client, events tagged with tick, world seed and entity IDs
- [x] pino structured logging on the server
- [x] Invariant framework: checks run every tick in dev, sampled in prod, violations → Sentry
- [x] Tick-health reporting (duration, resident and action counts), alert above 800 ms
- [x] Accounts (ADR 0005): sign-up with invite code, login, logout, 30-day sessions, rate limit
- [x] Admin: `admin:create` command, create invite codes, reset passwords
- [x] WebSocket accepts only logged-in sessions; login screen in the client
- [x] Rolling compressed snapshots with pruning; world format version and migration chain
      (ADR 0006)
- [x] SQLite backups before migrating on start and daily, 14 days kept
- [x] Protocol: per-Player sync (in sight on connect, changes and left-sight ids per tick),
      orders with request id and ack/error
- [x] Deploy (ADR 0007): Dockerfile, compose with Caddy, GHCR + SSH workflow after CI on main
- [ ] **Daniel:** server with Docker, DNS record, GitHub secrets and `DEPLOY_ENABLED`, `.env` on
      the server (README, Deploy)

### 1. World map

- [ ] Seeded generator for a disc map with Plains, Forest, Hills, Mountain, Lake, Sea
- [ ] Disc ~1,440 tiles across (a tile ≈ 40 m, ~30 s to walk on plains)
- [ ] Terrain stored once as a binary blob, kept in memory (ADR 0006)
- [ ] Resource nodes (forest, stone, iron ore, gold ore) placed by terrain
- [ ] Explored terrain per Player; terrain served in 32×32 chunks, only explored ones
- [ ] PixiJS view with pan and zoom; only visible tiles rendered
- Done when: a fresh world shows a believable disc of terrain you can explore in the browser.

### 2. Residents and the starting city

- [ ] Resident with base stats, trained bonus, skills, health, hunger, age
- [ ] Player login creates a Leader and a starting city (≈8 residents, wooden wall, farm, food,
      horse, carriage) far from other Players
- [ ] Sight: residents see within a sight range; the sync sends only what is in sight
- [ ] Inspect a resident in the UI (design: the "Main Game Screen" canvas)
- Done when: two Players log in and each sees their own city, far apart.

### 3. Survive

- [ ] Game time (1 day = 1 hour, 1 year = 1 real day)
- [ ] Hunger and eating from storage; starvation after ~2 game days
- [ ] Farm produces food from its workers; spoilage
- [ ] Aging and death of old age
- Done when: a city with workers on the farm lives on; one without food starves.

## Next

### 4. Move and carry

- [ ] Orders: walk to, pick up, drop
- [ ] Terrain speed and food cost, Agility/Endurance modifiers
- [ ] Weight of goods, carry capacity from Strength

### 5. Workplaces on resource nodes

- [ ] Build mine / quarry / lumber camp on a node; smelter; mint
- [ ] Assign workers; output from Strength and skill, capped by max workers
- [ ] Holding a workplace = whoever works it

### 6. Carriages and supply routes

- [ ] Horses (stable, eating) and carriages (Driving skill, terrain limits)
- [ ] Repeating "haul from A to B" order

### 7. Pairing and children

- [ ] Pairing order, housing, food surplus, cooldown
- [ ] Inheritance of base stats, growing up

## Later

8. NPC cities and villages; integrating (conquer, buy, persuade); NPC growth
9. Trade Organization: HQ, trading posts, stock floor, prices, transfers, its workplaces
10. Combat, armies and supply, loot, capturing cities, mercenary contracts, Trade Org army
11. Crime, witnesses, standing, respect, Trade Org reactions
12. Alliances, derived territory, region map
13. Leader death, self-managed cities, respawn
14. Scripting: interpreter in `packages/lang` on top of the game API; script editor
15. Roads; admin directive

## Done

- [x] Monorepo with server, client and language packages (c6c1c79)
- [x] Game rules and glossary (`CONTEXT.md`), ADRs 0001–0007

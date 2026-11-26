# Backlog

Work lives in [GitHub Issues](https://github.com/dasanten/strategy-code-poc/issues): each slice
is an **epic** (label `epic`) with its **tickets** as sub-issues, in order. `/next-ticket` picks
the next one and works it into a PR (`.claude/commands/next-ticket.md`).

**Priority rule:** bugs first, then epics in order, so the game becomes playable sooner:
survive → produce → transport → grow → trade → fight → alliances → scripts → roads. Exception:
the UI redesign (Epic 17, ADR 0008), then the livelier pace and default scripts (Epic 18, ADR
0009), go ahead of the remaining gameplay epics. The admin map (Epic 19) runs in parallel with
Epic 18, ahead of Bandits. Agreed with Daniel on 2026-10-28: Quick wins 2 (Epic 30), Food pickup
(31), Outpost storage (32) and UI overhaul and mobile (33), in that order, go ahead of Bandits.
Agreed with Daniel on 2026-10-29: Faster checks (Epic 34, ADR 0013) first, since every other
ticket waits on checks; then Riding and horses (35), Mountain roads (40), Script params (36),
Queue planner and groups (37), Children and food (38) and Passenger carriages (39), in that
order, all ahead of Bandits. The tickets of 35–40 wait for Epic 34's T34.1 and T34.2. Agreed
later the same day: Scripts started directly (41, ADR 0014), Script debugging (42) and Script
library tidy-up (43) come right after Script params (36). So: 35, 40, 36, 41, 42, 43, 37, 38,
39, then Bandits. Agreed with Daniel on 2026-10-30: the bugs #508–#510 first, then Server
hardening (Epic 44, the nine findings of the 2026-10-30 security review), Quick wins 3 (45),
Horses and food (46) and Under attack (47), in that order, all ahead of Bandits. Agreed with
Daniel on 2026-10-31: NPC ambitions (Epic 48, ADR 0016, `docs/proposals/npc-ambitions.md`) next,
ahead of Bandits.
Agreed with Daniel on 2026-10-31, once its tickets were written: Cheaper ticks (Epic 49, the
server-load review of the same day) comes right after NPC ambitions, ahead of everything agreed
for after it. Agreed with Daniel later on 2026-10-31: then Quick wins 4 (Epic 50: the whole
footprint workable, smooth movement on the map, horse names and a Horses drawer), Saved queues and
repeats (51) and Training (52), in that order, all ahead of Bandits. Agreed with Daniel later on
2026-10-31: then Clear trading (Epic 53: the trade section explains itself) and Holding the town
hall (54, ADR 0017: a city is captured by occupying its town hall for some game days), in that
order, both ahead of Bandits. Agreed with Daniel on 2026-11-01: Relocating (Epic 55: a Player moves
residents to another city of their realm) next, ahead of Bandits. Agreed with Daniel later on
2026-11-01: Seeing the plan (Epic 56: every way, steady motion, the picked residents' places and
planned building on the map) runs alongside Relocating (55), then Build line (57, ADR 0018: road
and wall lines as a task for a crew), both ahead of Bandits. Agreed with Daniel on 2026-11-02,
from the UX review of that day: Clearer play (Epic 58, ADR 0019: order rows keep their slot,
predictable picking, previewed picks, one lane for notices, a first-day card), then Clearer
screens (59: unique game-given names, the minimap, structured cards and forms, the phone layout,
scripting entry), both ahead of Bandits. Agreed with Daniel later on 2026-11-02, from his list of
that day: Quick wins 5 (Epic 60: roads and ways far out, Work on a site), Workplace settings (61,
ADR 0020), Readable cards (62: goods icons, facts as rows), Down, not dead (63, ADR 0021) and
Waypoints and exploring (64), in that order, all ahead of Bandits. Agreed with Daniel on
2026-11-03, from his list of horse bugs: Horses and stealing (Epic 65, ADR 0022: a joining city
brings its horses, Feed a horse, stealing carriages and horses) next, ahead of Bandits. Agreed with
Daniel on 2026-11-04: Quick wins 6 (Epic 66: getting away under attack, offering horses again,
workplace amounts) next, ahead of Bandits. Agreed with Daniel later on 2026-11-04, from his list of
that day: the bug #798 (the Trade Org's army turns back before it arrives) first, then Quick wins 7
(Epic 67: breeding shows names and stats, orders start at once), Build menu (68), Residents list
(69), Swaps and offers (70), Wandering traders (71, ADR 0023), Demands (72, ADR 0024) and Trade Org
debt (73, ADR 0025), in that order, all ahead of Bandits. Agreed with Daniel on 2026-11-05, from his list of
that day: the bug #878 (NPC residents stop getting commands) first, then, after Trade Org debt (73),
Quick wins 8 (Epic 74: hitching the horse you choose, realm goods in the top bar, trade standing),
Living NPC cities (75, ADR 0026: road crews, scouts, work for surplus), City layouts (76) and Horse
market (77, ADR 0027), in that order, all ahead of Bandits. Adding Claude API calls to NPC cities was
looked at the same day and left out for now: these epics fix what makes them look idle, at no running
cost. Agreed with Daniel on 2026-11-06: the bug #936 (NPC soldiers don't fight occupiers) first, then
Balance and art (Epic 78: coins, training numbers, a training ground image), City guards (79, ADR 0028:
the Alarm script) and Busy big cities (80, ADR 0029: the planner scores its jobs, and big cities get
more to do), in that order, all ahead of Bandits. Tickets that need an earlier epic name it
under Depends on, and wait for it to reach `dev`.

**Decided with Daniel on 2026-11-07 (ADR 0030, `docs/proposals/rust-rewrite.md`): the backend is
rewritten in Rust** on the branch `rust-backend`, and the TypeScript game is under a feature
freeze (bugs only) until the cutover. The rewrite epics, in order: Rust foundations (84), Pure
kernels (85, in parallel with 84), The rules (86), The shell (87), Client and cutover (88). Their
branches come from and go into `rust-backend`. Epics 81 to 83 (measuring and TypeScript
optimisations) are superseded by the rewrite, which includes their aims.

**Cutover (T88.6, 2026-11-10):** the Rust backend supports every feature, `rust-backend` goes into
`dev`, and the TypeScript server, `packages/shared` and `packages/lang` are deleted. **The feature
freeze is lifted:** new epics branch from `dev` again (ADR 0009, 0010), and rule changes are
Daniel's call as before.

**Rust follow-ups (Epic 89, 2026-11-10):** written with Daniel from an audit of what the rewrite
left of Epics 81 and 82's aims: placeholder tests, measurements after the port, profiling, tick
health on the admin panel, slow tests back in the suite. T89.1 (the 21 placeholder tests) should
land before the next `dev` → `main` release. Merged into `dev` on 2026-11-11.

**Agreed with Daniel on 2026-11-11:** Havens and boats (Epic 90, ADR 0031: Lake and Sea crossed by
boats rowed from any shore), then Ships (91: crewed ships between havens, haul routes by water),
both ahead of Bandits.

**Agreed with Daniel on 2026-11-12,** from an evaluation of the NPC planner: Cities that can't be
talked over (Epic 96, ADR 0033: an NPC city yields only to a force that stays, and lends only what
it can spare), then Goods get used (97: lasting outlets for a big NPC city's goods and work for its
soldiers, the fix for its idle crowd), then NPC cities with intent (98: stance, threat memory,
temperament, acting first), in that order, all ahead of Bandits. They touch NPC rules only and run
alongside Ships (91) and the UI epics (92 to 95).

**Agreed with Daniel on 2026-11-12,** from a UX review of the left menus and the queue editor:
Queue planner rework (Epic 92: drafts, Clear, one-line steps, a grouped palette, blocks and
brackets), Cities drawer (93) and Clearer menus (94: rail groups, one Diplomacy drawer, unseen
marks) run side by side, all client only; then Queue conditions (95, ADR 0032: repeat blocks on the
server, If blocks, Wait until), which needs Epic 92 on `dev`. All ahead of Bandits.

**Agreed with Daniel on 2026-11-12:** Faster map loading (Epic 99, ADR 0034: explored terrain by
level for the minimap and the far zoom, compressed and kept in the browser, with Last seen and the
Region map sending only what changed) runs alongside the open epics, ahead of Bandits. It changes
no rule.

**Agreed with Daniel on 2026-11-14,** from his finding that the game loop ends fast and then gets
boring: Scarce land, as one reset of the world (ADR 0035). A new world (Epic 100: a mainland of
heartlands and frontier regions joined by passes and land bridges, islands by vessel only, Players
starting as neighbours, and the reset), then Rich and poor land (101: richness, Coal and Steel, no
gold in a heartland), then Veins run dry (102), each waiting for the one before to reach `dev`.
An heir (Epic 103: a named heir keeps one city at Leader death) runs alongside Epic 100. The three
of 100 to 102 are released together, and Daniel runs the reset at that release. Whether NPC cities
fight for nodes they lack: settled 2026-11-16 (Epic 98, `docs/context/npc-stances.md`: Taking a node). Agreed
with Daniel on 2026-11-16: Epics 97 and 98 are ticketed and worked alongside the fighting epics (104 to
110).

**Agreed with Daniel on 2026-11-15,** from his wish to upgrade fighting: Safe start (Epic 104: new
cities spawn with Spears and a stable hand on a "Farm and feed" queue), Walls that hold (105, ADR
0036: a wall walk that is high ground, so early cities can't take each other) and Equipment (107,
ADR 0038: weapon, shield and armour slots others see) run side by side first; then Stone walls
(106, after 105), Bows and crossbows (108, after 105 and 107), Towers (109, after 106 and 108) and
Siege machines (110, ADR 0037, after 106), each waiting for the epics it builds on to reach `dev`.
All ahead of Goods get used (97), NPC cities with intent (98) and Bandits.

**Agreed with Daniel on 2026-11-18,** from measuring where checks spend their time: Faster checks
and simulation tests (Epic 111, ADR 0040: checks share the machine, a profile and commands for the
slow runs, every ignored test nightly, year-run checkpoints). No game rule changes; it runs beside
the game epics.

**Agreed with Daniel on 2026-11-18:** Realm control mode (Epic 112, ADR 0041: a Unit | Realm
switch; in realm control mode the Player says what and where, then picks who from a who-list with
the nearest idle residents suggested; only the UI) is planned now and starts once Faster checks
and simulation tests (Epic 111) is on `dev`.

**Agreed with Daniel on 2026-11-19,** from a review of the early game (rated 4 of 10: little to
do in the first hour, eight residents for the first days, nothing gained by being online): Quicker
start (Epic 113: starting Wood, Stone and Tools, a forest node close by, a shorter pairing wait and
childhood; numbers only), Gathering by hand (114: Wood, Stone and Food from any Forest or Hills
tile, with patches that are picked over and grow back), Drifters (115: a small realm with free
housing and a food surplus draws grown newcomers) and Zeal (116, ADR 0042: a pool the Player
spends by hand, the Leader rallying a crew to three times its pace), in that order. They don't
depend on each other; 114 and 115 each bump the world format, in that order.

**Agreed with Daniel on 2026-11-21:** Creative mode (Epic 117, ADR 0043: on a server started with
`CREATIVE=1` only, an admin pauses, steps, speeds up and skips the world, uses creative actions on
any realm, saves and restores checkpoints and makes small test worlds). Nothing else is open, so
it goes next; it changes no rule of the live game.

**Agreed with Daniel on 2026-11-22,** from his wish for a completely new UI now that the functions
are in: Pixel frontier UI (Epic 119, ADR 0044: one pixel look for everyone, a command bar along
the bottom, a sidebar with tabs, a dock on the right, a script workshop, Pixel as the default art
style; every screen and function stays, nothing is added). Nothing else is open, so it goes next.
It is built on its epic branch, replacing the old UI there, and `dev` keeps the old UI until the
whole epic merges; a feature epic that reaches `dev` meanwhile is merged into it. The functions
the design sketches beyond the game (Find, idle and hungry buttons, list and log filters, a saved
groups strip) wait for an epic after it.

**Agreed with Daniel on 2026-11-25,** from a survey of what makes the codebase slow to change and
hard for parallel sessions to share: the bug #1559 first, then Fewer collisions (Epic 120: the
files every ticket edits are split along their seams, and `CONTEXT.md` becomes an index with a
file per section), Content defined once (121: a building kind, a good, a vessel, a siege machine
and an order are each defined in one place), One copy of the rules (122: the client runs the Rust
rules as wasm instead of a hand-written TypeScript copy), Client tidy (123) and Agent docs (124:
an architecture map and how-to recipes, written last so they describe what the others leave
behind), in that order. None changes a game rule. While Epic 120 is open no feature epic runs
beside it. Bandits (16) stays set aside.

**PoC done** = Epic 6 closed: my residents mine iron far away, and a carriage brings it home while
I sleep.

## Epics

| #   | Epic                                                                                            | State                   |
| --- | ----------------------------------------------------------------------------------------------- | ----------------------- |
| 0   | [Project setup](https://github.com/dasanten/strategy-code-poc/issues/4)                         | code done; needs Daniel |
| 1   | [World map](https://github.com/dasanten/strategy-code-poc/issues/8)                             | ticketed                |
| 2   | [Residents and the starting city](https://github.com/dasanten/strategy-code-poc/issues/14)      | ticketed                |
| 3   | [Survive](https://github.com/dasanten/strategy-code-poc/issues/19)                              | ticketed                |
| 4   | [Move and carry](https://github.com/dasanten/strategy-code-poc/issues/26)                       | ticketed                |
| 5   | [Workplaces on resource nodes](https://github.com/dasanten/strategy-code-poc/issues/32)         | ticketed                |
| 6   | [Carriages and supply routes](https://github.com/dasanten/strategy-code-poc/issues/38)          | ticketed, PoC done      |
| 7   | [Pairing and children](https://github.com/dasanten/strategy-code-poc/issues/43)                 | ticketed                |
| 8   | [NPC cities and integrating](https://github.com/dasanten/strategy-code-poc/issues/46)           | ticketed                |
| 9   | [Trade Organization](https://github.com/dasanten/strategy-code-poc/issues/47)                   | ticketed                |
| 10  | [Combat and armies](https://github.com/dasanten/strategy-code-poc/issues/48)                    | ticketed                |
| 11  | [Crime and reputation](https://github.com/dasanten/strategy-code-poc/issues/49)                 | ticketed                |
| 12  | [Alliances and territory](https://github.com/dasanten/strategy-code-poc/issues/50)              | ticketed                |
| 13  | [Leader death and self-managed cities](https://github.com/dasanten/strategy-code-poc/issues/51) | ticketed                |
| 14  | [Scripting](https://github.com/dasanten/strategy-code-poc/issues/52)                            | ticketed                |
| 15  | [Roads and admin directive](https://github.com/dasanten/strategy-code-poc/issues/53)            | ticketed                |
| 16  | [Bandits](https://github.com/dasanten/strategy-code-poc/issues/144)                             | scope only              |
| 17  | [Game UI redesign](https://github.com/dasanten/strategy-code-poc/issues/202)                    | ticketed                |
| 18  | [Livelier pace and default scripts](https://github.com/dasanten/strategy-code-poc/issues/220)   | ticketed                |
| 19  | [Admin map](https://github.com/dasanten/strategy-code-poc/issues/232)                           | ticketed                |
| 20  | [Leader handover](https://github.com/dasanten/strategy-code-poc/issues/244)                     | ticketed                |
| 21  | [Tile card info](https://github.com/dasanten/strategy-code-poc/issues/269)                      | ticketed                |
| 22  | [Wiki](https://github.com/dasanten/strategy-code-poc/issues/276)                                | ticketed                |
| 23  | [Names](https://github.com/dasanten/strategy-code-poc/issues/288)                               | ticketed                |
| 25  | [Quick wins](https://github.com/dasanten/strategy-code-poc/issues/320)                          | ticketed                |
| 30  | [Quick wins 2](https://github.com/dasanten/strategy-code-poc/issues/375)                        | ticketed                |
| 31  | [Food pickup](https://github.com/dasanten/strategy-code-poc/issues/376)                         | ticketed                |
| 32  | [Outpost storage](https://github.com/dasanten/strategy-code-poc/issues/377)                     | ticketed                |
| 33  | [UI overhaul and mobile](https://github.com/dasanten/strategy-code-poc/issues/378)              | ticketed                |
| 34  | [Faster checks](https://github.com/dasanten/strategy-code-poc/issues/414)                       | ticketed                |
| 35  | [Riding and horses](https://github.com/dasanten/strategy-code-poc/issues/418)                   | ticketed                |
| 36  | [Script params](https://github.com/dasanten/strategy-code-poc/issues/423)                       | ticketed                |
| 37  | [Queue planner and groups](https://github.com/dasanten/strategy-code-poc/issues/427)            | ticketed                |
| 38  | [Children and food](https://github.com/dasanten/strategy-code-poc/issues/431)                   | ticketed                |
| 39  | [Passenger carriages](https://github.com/dasanten/strategy-code-poc/issues/434)                 | ticketed                |
| 40  | [Mountain roads](https://github.com/dasanten/strategy-code-poc/issues/442)                      | ticketed                |
| 41  | [Scripts started directly](https://github.com/dasanten/strategy-code-poc/issues/450)            | ticketed                |
| 42  | [Script debugging](https://github.com/dasanten/strategy-code-poc/issues/451)                    | ticketed                |
| 43  | [Script library tidy-up](https://github.com/dasanten/strategy-code-poc/issues/452)              | ticketed                |
| 44  | [Server hardening](https://github.com/dasanten/strategy-code-poc/issues/511)                    | ticketed                |
| 45  | [Quick wins 3](https://github.com/dasanten/strategy-code-poc/issues/522)                        | ticketed                |
| 46  | [Horses and food](https://github.com/dasanten/strategy-code-poc/issues/527)                     | ticketed                |
| 47  | [Under attack](https://github.com/dasanten/strategy-code-poc/issues/531)                        | ticketed                |
| 48  | [NPC ambitions](https://github.com/dasanten/strategy-code-poc/issues/567)                       | ticketed                |
| 49  | [Cheaper ticks](https://github.com/dasanten/strategy-code-poc/issues/574)                       | ticketed                |
| 50  | [Quick wins 4](https://github.com/dasanten/strategy-code-poc/issues/582)                        | ticketed                |
| 51  | [Saved queues and repeats](https://github.com/dasanten/strategy-code-poc/issues/588)            | ticketed                |
| 52  | [Training](https://github.com/dasanten/strategy-code-poc/issues/592)                            | ticketed                |
| 53  | [Clear trading](https://github.com/dasanten/strategy-code-poc/issues/631)                       | ticketed                |
| 54  | [Holding the town hall](https://github.com/dasanten/strategy-code-poc/issues/632)               | ticketed                |
| 55  | [Relocating](https://github.com/dasanten/strategy-code-poc/issues/652)                          | ticketed                |
| 56  | [Seeing the plan](https://github.com/dasanten/strategy-code-poc/issues/659)                     | ticketed                |
| 57  | [Build line](https://github.com/dasanten/strategy-code-poc/issues/660)                          | ticketed                |
| 58  | [Clearer play](https://github.com/dasanten/strategy-code-poc/issues/687)                        | ticketed                |
| 59  | [Clearer screens](https://github.com/dasanten/strategy-code-poc/issues/693)                     | ticketed                |
| 60  | [Quick wins 5](https://github.com/dasanten/strategy-code-poc/issues/717)                        | ticketed                |
| 61  | [Workplace settings](https://github.com/dasanten/strategy-code-poc/issues/718)                  | ticketed                |
| 62  | [Readable cards](https://github.com/dasanten/strategy-code-poc/issues/719)                      | ticketed                |
| 63  | [Down, not dead](https://github.com/dasanten/strategy-code-poc/issues/720)                      | ticketed                |
| 64  | [Waypoints and exploring](https://github.com/dasanten/strategy-code-poc/issues/721)             | ticketed                |
| 65  | [Horses and stealing](https://github.com/dasanten/strategy-code-poc/issues/769)                 | ticketed                |
| 66  | [Quick wins 6](https://github.com/dasanten/strategy-code-poc/issues/787)                        | ticketed                |
| 67  | [Quick wins 7](https://github.com/dasanten/strategy-code-poc/issues/799)                        | ticketed                |
| 68  | [Build menu](https://github.com/dasanten/strategy-code-poc/issues/803)                          | ticketed                |
| 69  | [Residents list](https://github.com/dasanten/strategy-code-poc/issues/806)                      | ticketed                |
| 70  | [Swaps and offers](https://github.com/dasanten/strategy-code-poc/issues/810)                    | ticketed                |
| 71  | [Wandering traders](https://github.com/dasanten/strategy-code-poc/issues/817)                   | ticketed                |
| 72  | [Demands](https://github.com/dasanten/strategy-code-poc/issues/822)                             | ticketed                |
| 73  | [Trade Org debt](https://github.com/dasanten/strategy-code-poc/issues/827)                      | ticketed                |
| 74  | [Quick wins 8](https://github.com/dasanten/strategy-code-poc/issues/880)                        | ticketed                |
| 75  | [Living NPC cities](https://github.com/dasanten/strategy-code-poc/issues/885)                   | ticketed                |
| 76  | [City layouts](https://github.com/dasanten/strategy-code-poc/issues/891)                        | ticketed                |
| 77  | [Horse market](https://github.com/dasanten/strategy-code-poc/issues/897)                        | ticketed                |
| 78  | [Balance and art](https://github.com/dasanten/strategy-code-poc/issues/937)                     | ticketed                |
| 79  | [City guards](https://github.com/dasanten/strategy-code-poc/issues/941)                         | ticketed                |
| 80  | [Busy big cities](https://github.com/dasanten/strategy-code-poc/issues/947)                     | ticketed                |
| 84  | [Rust backend: foundations](https://github.com/dasanten/strategy-code-poc/issues/1001)          | ticketed                |
| 85  | [Rust backend: pure kernels](https://github.com/dasanten/strategy-code-poc/issues/1002)         | ticketed                |
| 86  | [Rust backend: the rules](https://github.com/dasanten/strategy-code-poc/issues/1003)            | scope only              |
| 87  | [Rust backend: the shell](https://github.com/dasanten/strategy-code-poc/issues/1004)            | scope only              |
| 88  | [Rust backend: client and cutover](https://github.com/dasanten/strategy-code-poc/issues/1005)   | scope only              |
| 89  | [Rust follow-ups](https://github.com/dasanten/strategy-code-poc/issues/1126)                    | ticketed                |
| 90  | [Havens and boats](https://github.com/dasanten/strategy-code-poc/issues/1146)                   | ticketed                |
| 91  | [Ships](https://github.com/dasanten/strategy-code-poc/issues/1153)                              | ticketed                |
| 92  | [Queue planner rework](https://github.com/dasanten/strategy-code-poc/issues/1168)               | ticketed                |
| 93  | [Cities drawer](https://github.com/dasanten/strategy-code-poc/issues/1169)                      | ticketed                |
| 94  | [Clearer menus](https://github.com/dasanten/strategy-code-poc/issues/1170)                      | ticketed                |
| 95  | [Queue conditions](https://github.com/dasanten/strategy-code-poc/issues/1171)                   | ticketed                |
| 96  | [Cities that can't be talked over](https://github.com/dasanten/strategy-code-poc/issues/1188)   | ticketed                |
| 97  | [Goods get used](https://github.com/dasanten/strategy-code-poc/issues/1189)                     | ticketed                |
| 98  | [NPC cities with intent](https://github.com/dasanten/strategy-code-poc/issues/1190)             | ticketed                |
| 99 | [Faster map loading](https://github.com/dasanten/strategy-code-poc/issues/1198) | ticketed |
| 100 | [A new world](https://github.com/dasanten/strategy-code-poc/issues/1253) | ticketed |
| 101 | [Rich and poor land](https://github.com/dasanten/strategy-code-poc/issues/1262) | ticketed |
| 102 | [Veins run dry](https://github.com/dasanten/strategy-code-poc/issues/1269) | ticketed |
| 103 | [An heir](https://github.com/dasanten/strategy-code-poc/issues/1274) | ticketed |
| 104 | [Safe start](https://github.com/dasanten/strategy-code-poc/issues/1299) | ticketed |
| 105 | [Walls that hold](https://github.com/dasanten/strategy-code-poc/issues/1303) | ticketed |
| 106 | [Stone walls](https://github.com/dasanten/strategy-code-poc/issues/1310) | ticketed |
| 107 | [Equipment](https://github.com/dasanten/strategy-code-poc/issues/1314) | ticketed |
| 108 | [Bows and crossbows](https://github.com/dasanten/strategy-code-poc/issues/1318) | ticketed |
| 109 | [Towers](https://github.com/dasanten/strategy-code-poc/issues/1324) | ticketed |
| 110 | [Siege machines](https://github.com/dasanten/strategy-code-poc/issues/1328) | ticketed |
| 111 | [Faster checks and simulation tests](https://github.com/dasanten/strategy-code-poc/issues/1417) | ticketed |
| 112 | [Realm control mode](https://github.com/dasanten/strategy-code-poc/issues/1426) | ticketed |
| 113 | [Quicker start](https://github.com/dasanten/strategy-code-poc/issues/1453) | ticketed |
| 114 | [Gathering by hand](https://github.com/dasanten/strategy-code-poc/issues/1454) | ticketed |
| 115 | [Drifters](https://github.com/dasanten/strategy-code-poc/issues/1455) | ticketed |
| 116 | [Zeal](https://github.com/dasanten/strategy-code-poc/issues/1456) | ticketed |
| 117 | [Creative mode](https://github.com/dasanten/strategy-code-poc/issues/1498) | ticketed |
| 118 | [Pixel art](https://github.com/dasanten/strategy-code-poc/issues/1514) | done in one session |
| 119 | [Pixel frontier UI](https://github.com/dasanten/strategy-code-poc/issues/1519) | ticketed |
| 120 | [Fewer collisions](https://github.com/dasanten/strategy-code-poc/issues/1560) | done |
| 121 | [Content defined once](https://github.com/dasanten/strategy-code-poc/issues/1568) | done |
| 122 | [One copy of the rules](https://github.com/dasanten/strategy-code-poc/issues/1579) | ticketed |
| 123 | [Client tidy](https://github.com/dasanten/strategy-code-poc/issues/1588) | ticketed, after 122 |
| 124 | [Agent docs](https://github.com/dasanten/strategy-code-poc/issues/1595) | ticketed, after 123 |

Live progress is on each epic (sub-issue progress bar); this table only changes when an epic gets
its tickets or closes.

## How tickets work

- **Status:** open = to do, closed = done (closed by the PR that merges). Labels: `in progress`
  (someone is on it), `blocked` (waiting on something outside its Depends-on list), `needs Daniel`
  (a rule decision or manual step only Daniel can do; never picked up automatically).
- **Dependencies:** a ticket's "Depends on #n" line. A ticket is ready when all of them are
  closed.
- **Branches (ADR 0009, 0010):** each epic has a branch `epic/<n>-<slug>`, cut from `dev` when
  its first ticket starts. Ticket branches come from the epic branch and their PRs target it.
  Bugs branch from `dev` and go straight back to it.
- **PRs:** one per ticket; tickets that can't ship apart share one. The body says
  `Closes #<ticket>` for each and `Part of #<epic>`. Ticket PRs get no CI: the ticket session runs
  `pnpm check origin/epic/<n>-<slug>` (lint, typecheck and the tests the change affects, ADR 0013),
  and before merging into the epic branch the coordinating session runs it again on the PR merged
  with the epic branch. PR bodies say "Checked: `pnpm check` against …" with what it ran. Merging into a
  non-default branch doesn't close the ticket, so whoever merges closes its tickets by hand.
- **Slow tests:** a test that takes more than about 20 s on an idle machine (a long simulation)
  gets `{ tags: ['slow'] }` on its `it` or `describe`, with any timeout in the same object
  (`{ tags: ['slow'], timeout: 120_000 }`: Vitest ignores a trailing timeout next to options).
  `pnpm check` skips them, even when affected, and says how many; `pnpm test` runs them, and CI
  runs `pnpm test`.
- **Epic PR:** when an epic's last ticket is on its branch, one PR `epic/<n>-…` → `dev` with
  `Closes #<epic>` runs CI and is merged once green; whoever merges closes the epic by hand.
- **Release:** when Daniel asks, one PR `dev` → `main` lists the epics and bugs it ships, runs CI
  and is merged once green. Only merges into `main` deploy.
- **Rules vs numbers:** a missing game rule becomes a `needs Daniel` question and lands in
  its section file under `docs/context/` (a new term also in `CONTEXT.md`, the
  index). Balance numbers are picked in `crates/csp-shared/src/balance/` (one file per domain) and listed in
  the PR for review.
- **Scope-only epics:** an epic without tickets lists its open rule questions. When the epic
  before it is nearly done, settle those questions with Daniel, then write its tickets.
- **Every ticket:** read the index `CONTEXT.md`, then the section files under `docs/context/` the
  ticket names, and use their terms; a ticket names the section files it builds on; keep scripting
  cheap (ADR 0002); new
  simulation rules come with invariants and tests (ADR 0004); each epic ends visible in the
  browser.

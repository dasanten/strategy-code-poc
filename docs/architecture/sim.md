# The simulation: a map of `csp-sim`

Where things are in the simulation crate (`crates/csp-sim`) and the order a tick runs them in. It
points to code; each module's own header says the rest. Terms are `CONTEXT.md`'s. Checked by
`crates/csp-sim/tests/sim_map.rs`: every module of `src/lib.rs` is named here, and the two tick
lists name every step `step_world` and `step_rest` call, in their order.

## The crates

- `csp-shared`: the world's data (`src/world/`), balance numbers (`src/balance/`, ADR 0030),
  terrain helpers and the wire protocol. Plain serialisable data, no rules. `WORLD_FORMAT_VERSION`
  is in `src/world/world_format.rs`.
- `csp-sim` (this map): every rule. Pure over `csp-shared` data, no I/O.
- `csp-server`: the I/O shell. The loop (`server.rs`) calls `run_tick` and does the phases after
  the world's (territory, sight, broadcast, save); HTTP (`app.rs`), WebSocket (`realtime.rs`),
  what each client was sent (`sync.rs`), SQLite (`db/`), saves (`saves.rs`), save migrations
  (`world_format.rs`, ADR 0006), `csp-admin` and the bench binaries (`src/bin/`).
- `csp-lang`: the script language: lexer, parser, checker, interpreter with a step budget.
- `csp-lang-wasm`: the checker and the client's copy of the rules built to WebAssembly for the
  client (`packages/lang-wasm`); what may go in it is `docs/wasm-rules.md`.

## From a request to a change (ADR 0002)

1. A Player's request arrives over the WebSocket (`csp-server/src/realtime.rs`) as an
   `OrderRequest`. `orders.rs` finds its kind (`order_kinds`, built from each kind's `OrderMeta`
   in `order_meta.rs`), checks it (`validate`) and queues it.
2. At the start of the next tick (`TickPhase::Orders`) the queue applies every order: `apply` only
   sets order state, plain data on the resident (`ResidentOrder`, `running.rs`), or on an army or
   realm. Queues (`queues.rs`) and scripts (`script_runner.rs`) run next and give orders the same
   way; a script asks for an order through its `ScriptAction` (`script_actions.rs`).
3. In the world step each rule's `request_*` turns the order state into actions and its
   `resolve_*` carries them out and changes the world (the tick order below).
4. How to add an order kind, a building, a good or a vessel: `docs/adding-content.md`.

Elsewhere: read-only queries the API, sight and the client share are `queries/`; the invariants
(ADR 0004) are `invariants/` (one file per area) and run in `run_tick`; NPC cities act through
orders like Players (`npc_behaviour.rs`, `npc_plan.rs`); saves and migrations are `csp-server`'s.
The frozen TypeScript output the parity tests read is `fixtures/`; never edit it.

## The tick

`tick.rs`'s `run_tick` runs the phases (`TICK_PHASES`): Orders, Queues, Scripts, World,
Invariants; the server then runs Territory, Sight, Broadcast and Save. World is `step_world`
(`world.rs`), timed in four parts: Npc, Walking, Rest and LastSeen. "Needs" says what a step relies
on having run before it, where the code says so; otherwise it is unknown.

### `step_world`

1. `equipment::settle_all`: gear picked up or put down outside a tick fills or empties its slot.
2. `new_sight_phase`: what the scripts saw is gone.
3. `step_survival`: hunger, eating, Down, dying.
4. `step_horses`: horses' hunger, health, Down and dying.
5. `step_spoilage`: Food spoils.
6. `step_stock_floor`: the stock floor tops up.
7. `zeal::step_zeal`: every Player's Zeal fills.
8. `step_caravans`, `step_traders`: the Trade Organization's caravans and wandering traders.
9. `step_npc_defence`: posts and the HQ send their armed after attackers.
10. `npc_hunts::step_npc_hunts`: NPC cities send soldiers after thieves.
11. `npc_take_node::step_npc_take_nodes`: taking a node a city lacks.
12. `npc_acting_first::step_npc_acting_first`: seeking allies and mercenaries. Needs: before the
    Trade Org army answers offers (step 14).
13. `npc_retaliate::step_npc_retaliate`: turning on those who hurt them.
14. `step_trade_org_army`: the HQ's soldiers.
15. `step_npc_hire`: hiring from an NPC city; the lent gear goes to the scratch.
16. `equipment::settle_all`: gear handed out with lent soldiers is theirs.
17. `step_punishments`: the Trade Organization punishes.
18. `step_npc_cities`: every NPC city's planning pass and orders (`npc_behaviour`).
19. `equipment::settle_all`: so scripts see the slots the cities filled.
20. `run_npc_scripts`: the NPC residents' scripts.
21. `keep_down_still`: an order the cities gave someone Down ends.
22. `walk`: everyone walks (the Walking part; nobody moves without it).
23. `step_rest`: everything else, the list below.
24. `new_sight_phase`: sight is worked out again, now that everyone moved.
25. `step_last_seen`, `new_veins::reveal_new_veins`: Last seen, then new veins come into sight.
26. `step_riders`, `step_passengers`: riders and passengers who lost their mount or carriage get
    off.
27. `siege::step_siege_machines`: a machine's crew is who is with it now. Needs: everyone moved.
28. `keep_down_still`: an order a fight or army gave someone Down ends.
29. `equipment::settle_all`: last, after everything that moved goods this tick.
30. `wear::settle_wear`: worn pieces stay with the units still kept.
31. `settle`: the orders scripts wait on (`scratch.waiting`).

### `step_rest`

1. `step_relocating`: relocating residents who reached their new city move in.
2. `lent::drop_orders_against_lender`: a lent resident never acts against the city that lent them.
3. `equipment::settle_all`: what the scripts moved is equipped before blows are struck.
4. `request_strikes`, `resolve_strikes`: combat.
5. `siege::resolve_ram_strikes`, `cities::update_city_membership`: rams strike; membership is
   worked out again if something broke.
6. `siege::resolve_catapult_shots`, `cities::update_city_membership`: catapults throw.
7. `wall_walk::fall_from_broken`: whoever was up on a broken tile falls. Needs: steps 4–6.
8. `request_climbing`, `resolve_climbing`: climbing over walls.
9. `request_carrying`, `request_storing`, `request_hauling`, `request_water_hauling`,
   `request_road_materials`, `resolve_carrying_on`: every take and put, resolved together.
10. `equipment::settle_all`: gear picked up or put down fills its slot at once.
11. `step_feeding`: reviving and feeding horses.
12. `equipping::step_equipping`: gear swapped or taken off. Needs: before anything counts gear.
13. `resolve_payments`: mercenary contract payments.
14. `resolve_purchases`: buying a city.
15. `resolve_trades`: trades with the Trade Organization and NPC cities.
16. `resolve_offers`: offers accepted.
17. `resolve_buy_offs`: buy-offs of admin directives (recorded for the invariant).
18. `resolve_debt_payments`: Trade Org debt paid.
19. `rally::end_rallies`: a rally ends before anyone works if the Leader left. Needs: before work.
20. `request_building`, `resolve_building`: work on construction sites.
21. `request_tearing_down`, `resolve_tearing_down`, `count_wrecked`: tearing down; what the Trade
    Org army wrecked counts against a debt.
22. `repair::request_repairing`, `repair::resolve_repairing`: repairs.
23. `request_work`, `resolve_work`: work at workplaces.
24. `rally::drain_rallies`: the Zeal of each crew rallied this tick drains. Needs: work done.
25. `new_veins::step_new_veins`: a node that ran dry has a new one elsewhere. Needs: work done.
26. `gathering::request_gathering`, `gathering::resolve_gathering`: gathering by hand. Needs:
    after new veins, so no node can come up on a gatherer's tile this tick.
27. `step_teaching`, `step_training`: training grounds.
28. `request_breeding`, `resolve_breeding`: breeding horses.
29. `request_births`, `resolve_births`: pairing and children.
30. `tick += 1`: the tick turns.
31. `repair::step_decay`, `repair::trade_org_repairs`: decay at the turn of the day.
32. `gathering::step_patches`: patches grown back leave the list.
33. `ruins::step_ruins`: a building with no condition left is a ruin; old ruins collapse.
34. `step_aging`: growing up and dying of old age.
35. `answer_demands`: demands answered.
36. `step_alliances`: one tick of alliances.
37. `step_captures`: occupying town halls, capturing cities.
38. `step_refill`: refilling at outpost storages.
39. `step_directives`: admin directives.
40. `step_crimes`: crimes noted, news spreads.
41. `step_contracts`: mercenary contracts run and end.
42. `step_demands`: demands' deadlines.
43. `step_standing`: standing follows known crimes.
44. `step_debts`: Trade Org debt.
45. `step_persuasion`: persuading a city.
46. `step_armies`: armies.
47. `heir::lapse_heirs`: an heir who no longer qualifies lapses. Needs: cities, contracts and the
    alliance army changed hands this tick (steps 36–46).
48. `drifters::step_drifters`: drifters join or set out. Needs: births, captures and ruins.
49. `step_outsiders`: who came into a City area. Needs: everyone moved, nobody changes sides
    after.
50. `step_workplace_settings`: settings of buildings and realms that went are dropped.
51. `step_offers`: offers follow what this tick took from their storages.
52. `persuasion::step_outweighed`: who outweighs each NPC city. Needs: nothing else changes after
    (ADR 0033).
53. `npc_threat::step_threat`: threat from the armed residents NPC cities see.
54. `npc_stance::step_stances`: stances, at the first pass of each game day.
55. `npc_demands::step_npc_demands`: NPC demands.
56. `wall_walk::step_wall_walk`: who is up on a wall walk. Needs: walls broke and changed hands
    and residents moved this tick.

## The modules, by area

**World and land.** `terrain_gen` (the map from a seed), `land` (mainland and islands), `regions`
(heartlands, frontier), `region_map` (its invariant), `land_sites` (where the Trade Organization
and NPC cities stand), `starting_sites` and `player_start` (where a new Player starts),
`node_gen` (resource nodes at creation), `placing` (which tiles footprints cover), `random`
(seeded numbers, bit for bit the TypeScript's), `names` (game-given names), `world` (creating
a world, the tick order), `world_index` (once-a-tick lookups), `tick` (`run_tick`, phases,
`Scratch`, tick health).

**Resources and goods.** `work` (the work-at order), `gathering`, `veins` (running dry),
`new_veins`, `vein_stands` (how a vein stands, in words), `spoilage`, `stock_floor`,
`goods_made` (goods that came into the world this tick, for the invariant), `holders` (where
goods are kept, by position), `carrying` (take and put), `storing` (store and fetch),
`hauling` and `water_hauling` (haul routes), `loading` (a ship at its haven), `transfers`
(between realms), `deliveries`.

**Building.** `building` (construction sites), `teardown`, `repair` (decay and repairing),
`ruins`, `road_line` (road or wall along a line), `walls` (walls and gates for the path search),
`gates` (the gate order), `city_layout`, `workplace_settings` (ADR 0020).

**Organizations and territory.** `cities`, `starting_city`, `territory` (once a game hour, never
saved), `alliances`, `buying` (buying a city), `capture`, `relocating`, `renaming`, `waypoints`,
`outsiders` (who is in a City area), `alarms` (ADR 0028), `events` (realm logs).

**The Trade Organization.** `trade_org` (the HQ's layout), `hq_growth`, `hq_fall`,
`trading_posts`, `caravans`, `traders` and `trader_stops` (wandering traders), `trading` (buy,
sell, swap, horse market), `offers` (offers and direct offers), `trade_org_army`,
`trade_org_buying`, `trade_org_punishment`, `trade_org_debt`, `trade_org_wrecks`,
`trade_org_takes`, `supply_wagons`, `directives` (admin directives), `directive` (their queries).

**NPC cities.** `npc_cities` (coming to be), `npc_behaviour` (their tick), `npc_plan` (the
planning pass, ADR 0016), `npc_scores` (what a job is worth), `npc_chain` (what the reserve is
short of), `npc_supply`, `npc_coins`, `npc_growth`, `npc_founding`, `npc_roads`, `npc_scouts`,
`npc_trader`, `npc_escort`, `npc_stable`, `npc_revive`, `npc_repair`, `npc_mending`,
`npc_inner_wall`, `npc_stone_walls`, `npc_towers`, `npc_training`, `npc_posts`, `npc_patrols`,
`npc_defence`, `npc_hire`, `lent` (lent residents and their lender), `temperament`, `npc_stance`,
`npc_threat`, `npc_acting_first`, `npc_retaliate`, `npc_hunts`, `npc_take_node`, `npc_demands`.

**Military.** `combat`, `defence` (defence scripts, ADR 0015), `equipment` and `equipping`
(ADR 0038), `wear`, `mending`, `armies`, `siege` (rams and catapults, ADR 0037), `climbing`,
`wall_walk` (ADR 0036), `contracts` (mercenary contracts).

**Crime and reputation.** `crimes`, `standing`, `persuasion`, `stealing`, `demands` (ADR 0024).

**People and residents.** `leader`, `heir`, `zeal`, `rally` (ADR 0042), `residents`, `aging`,
`survival`, `reviving`, `pairing`, `drifters`, `teaching`, `training`, `creative` (creative
mode's actions, ADR 0043).

**Transport and water.** `horses`, `horse_grant`, `breeding`, `riding`, `driving`, `passengers`,
`rowing`, `sailing`, `walking` (walk, drive and ride along paths), `pathfinding`, `walk_time`
(rough times and Food for a way).

**Sight.** `sight` (what each side sees), `last_seen`, `explored` and `explored_edge`
(explored terrain), `mirror` (the client's world built from what it was sent, ADR 0045).

**Orders, queues and scripts.** `orders` (kinds, queue, apply), `order_meta` (what a kind says
of itself), `order_sender` (who may order whom), `running` (what a running order answers),
`queue`, `queue_tree` and `queues` (queues, ADR 0032), `conditions` (Wait until, If, Repeat
until), `scripts` (a script that can run), `script_runner`, `script_bindings` (the API bound for
a run), `script_api` (the API's names and step costs), `script_actions`, `script_tables` (what a
script sees, one module per table), `script_views` (ADR 0011), `script_check`, `script_params`,
`script_log`, `script_deps` (stand-ins for rules not ported yet), `default_scripts`.

**Reading the world.** `queries` (read-only queries the API, sight and the client share), `views`
(views the client imports), `admin_map` (the admin map's world), `invariants` (ADR 0004).

**Tests and fixtures.** `fixture_ages` (fixtures aged by today's rules), `goods_deps` (what the
goods rules call in other modules), and, test-only, `test_support`, `test_world`,
`game_test_world`, `movement_test_world`, `realm_test_world`, `npc_test_world`, `npc_slow` (the
slow NPC runs), `random_orders` (the random-order run: random requests to `test_world`'s
`two_realms_world`, every invariant after every tick, a failure shrunk to a replay file of its
fewest orders, `replays/` the replays kept as regression tests; ADR 0048),
`poc_tests`, `stone_upgrade_tests`.

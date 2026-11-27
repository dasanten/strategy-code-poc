# Decisions

One line per ADR: its number, title and state. Where an ADR and the game vision in `CONTEXT.md`
and `docs/context/` disagree, the vision wins. A new ADR takes the next free number and a line
here; `pnpm check` fails on a number used twice and on an ADR missing from this list
(`scripts/check-adrs.mjs`).

States: **in force**; **amended by** (a later ADR changes part of it, the rest stands);
**replaced in part by** (a later ADR or the Rust rewrite took over part of it); **to confirm**
(decided overnight, waiting for Daniel).

## Game

- [0003](0003-trade-org-stock-floor.md) Trade Organization warehouses never drop below a floor:
  amended by 0023 (trading posts have none).
- [0014](0014-default-script-targets-are-params.md) Default scripts take their target as a param:
  in force.
- [0015](0015-defence-scripts-interrupt-and-resume.md) A struck resident runs a defence script,
  then goes back to what they did: in force.
- [0017](0017-capture-by-holding-the-town-hall.md) A city is captured by holding its town hall for
  some game days: in force.
- [0018](0018-build-line-is-a-task.md) Road and wall lines are built as a task: in force.
- [0020](0020-workplace-settings.md) Work settings belong to the workplace, per realm: in force.
- [0021](0021-down-before-starving.md) Starving puts a resident Down before it kills: in force.
- [0022](0022-stealing-carriages-and-horses.md) Driving off in a carriage steals it: in force.
- [0023](0023-trading-posts-have-no-stock-floor.md) Trading posts have no stock floor: in force.
- [0024](0024-demands-are-instant-words-with-terms.md) Demands are instant words with terms:
  amended by 0033 (how an NPC city answers).
- [0025](0025-trade-org-debt-goes-up-steps.md) What the Trade Organization can't take back stays a
  debt: in force.
- [0027](0027-horses-are-sold-in-person-by-npc-cities.md) Horses are sold in person, by NPC
  cities: in force.
- [0028](0028-alarms-run-a-script-that-interrupts-and-resumes.md) Alarms run a script that
  interrupts and resumes: in force.
- [0031](0031-vessels-cross-water-only-on-purpose.md) Vessels cross water only on purpose: in
  force.
- [0032](0032-queues-hold-blocks.md) Queues hold blocks: in force.
- [0033](0033-npc-cities-yield-to-a-force-that-stays.md) NPC cities yield to a force that stays,
  and lend only what they can spare: in force.
- [0035](0035-one-reset-for-a-world-with-scarce-land.md) One reset for a world with scarce land:
  in force (done once).
- [0036](0036-the-wall-walk-is-high-ground.md) The wall walk is high ground: in force.
- [0037](0037-siege-machines-are-built-in-the-field.md) Siege machines are built in the field: in
  force.
- [0038](0038-gear-is-equipped-and-seen.md) Gear is equipped and seen: in force.
- [0042](0042-zeal-is-spent-by-hand.md) Zeal is spent by hand: in force.
- [0043](0043-creative-mode-is-local-only.md) Creative mode is local only: in force.
- [0046](0046-tasks-run-default-scripts.md) UI tasks run default scripts in the game language: in
  force (numbered 0009 until T124.4).

## Simulation and server

- [0001](0001-tech-stack-and-script-language.md) Tech stack and script language: replaced in part
  by 0006 (storage and map) and 0030 (the server is Rust); overtaken by `CONTEXT.md` where they
  disagree.
- [0002](0002-hybrid-control-ui-orders-plus-scripts.md) Hybrid control: UI orders plus optional
  scripts: in force; extended by 0011, amended by 0046.
- [0004](0004-monitoring-sentry-and-invariants.md) Monitoring: Sentry, simulation invariants and
  tick health: in force.
- [0005](0005-accounts-password-login-invite-codes.md) Accounts: username and password, invite
  codes, cookie sessions: in force.
- [0006](0006-world-storage-and-sight-sync.md) World storage, migrations and per-Player sync:
  replaced in part by 0034 (sync of explored terrain); set aside once by 0035.
- [0011](0011-script-views.md) Script views: what a script sees is declared, not the server's own
  objects: in force.
- [0016](0016-npc-cities-plan-once-a-game-hour.md) NPC cities think once a game hour and keep a
  stored plan: in force.
- [0026](0026-npc-spare-hands-always-have-work.md) NPC spare hands always have work, and news of
  far nodes is carried home: amended by 0029.
- [0029](0029-npc-planner-scores-its-jobs.md) The NPC planner scores its jobs, and big cities get
  more to do: amended by 0039.
- [0030](0030-rust-backend.md) The backend is rewritten in Rust: in force; amended by 0040.
- [0039](0039-npc-jobs-weigh-their-place.md) An NPC city's jobs weigh their place, not only their
  band: to confirm.

## Client

- [0008](0008-game-ui-board-game-map-and-hud.md) Game UI: board-game map, HUD over a full-screen
  map, SVG asset registry: replaced in part by 0044 (screen layout and panel style).
- [0012](0012-cards-with-tabs-and-mobile-bottom-sheets.md) Cards with tabs, pick mode and mobile
  bottom sheets: replaced in part by 0044 (where the card sits); amended by 0019.
- [0019](0019-order-rows-keep-their-slot.md) Order rows keep their slot while a card is open: in
  force.
- [0034](0034-the-map-loads-by-level-and-only-what-changed.md) The map loads by level, compressed,
  and only what changed: in force.
- [0041](0041-realm-control-mode-is-only-the-ui.md) Realm control mode is only the UI: in force.
- [0044](0044-pixel-frontier-ui-and-a-command-bar.md) Pixel frontier UI: one pixel look, a command
  bar, a sidebar and a dock: in force.
- [0045](0045-the-client-runs-the-rust-rules-as-wasm.md) The client runs the Rust rules as
  WebAssembly: in force.
- [0047](0047-pixel-art-is-exported-and-picked-as-a-style.md) Pixel art is exported from Aseprite
  and picked as an art style: in force (numbered 0043 until T124.4).

## Process

- [0007](0007-deploy-docker-ghcr-ssh-caddy.md) Deploy to Daniel's server: Docker image, GHCR, SSH,
  Caddy: in force.
- [0009](0009-epic-branches-and-local-checks.md) Epic branches, local checks, CI only into main:
  amended by 0010 and 0013.
- [0010](0010-dev-branch-and-releases.md) A dev branch, and releases into main: in force.
- [0013](0013-fast-local-checks.md) Fast local checks, the full suite only in CI: amended by 0040.
- [0040](0040-checks-share-the-machine.md) Checks share the machine; slow runs have their own
  profile: in force.

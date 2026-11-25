# Control: groups and queues

- **Group:** several of the Player's residents picked on the map at once (box-drag or
  Shift-click), so an order goes to each. Not an Army: nothing ties them together in the world.
  Ctrl+1–9 saves the picked residents as that number's group and 1–9 picks them again (pressed
  twice, it also centres the map on them); saved groups are kept per browser, not in the world.
  Dead residents and ones no longer the Player's drop out of a group when it is picked again.
  **One command for a group:** the group card gives each the same order request as their own card
  would (walk to, work, build, store, fetch, run a script, stop); nothing new is kept in the
  world. A walk-to spreads them over distinct free tiles around the target, the nearest of them
  to the nearest tile. Work and Build make each join the workplace or site: Build walks them
  there, the first lays out the site and the others join it; Work is tile-bound, so it goes only
  to those standing at the workplace. Every order a resident card offers is on the group card
  too (mount, feed the stable, breed, haul, Run script with its params, …). Those who can't take
  it (children, a partner carrying a child, too far for a tile-bound order) are skipped, and the
  card says who and why. **Planning for a group:** the group card has the same queue planner as
  a resident card; "Give to all" sets a copy of the planned steps as each member's queue, and
  appending (Shift, or Add step) adds the step to each member's own queue. Members' queues stay
  their own afterwards.
- **Queue:** an order holding a list of steps for a resident and which step they are on. A step
  is any order the Player could give them on its own: a one-off action (walk to, pick up, drop,
  Store, Fetch, …), a task, or one of their scripts with its params. A step ends when it's done
  (a walk arrives, a script calls `end()`), or once its duration in game minutes is up, if the Player gave
  it one; a task that never ends on its own (work, haul, feed the stable) needs a duration unless it's the last
  step. With **loop**, the first step follows the last; without, the queue ends after it. Steps
  can be added, removed and reordered while it runs: the current step keeps going unless removed,
  and then the step in its place starts. **Planning ahead:** a step may act somewhere else than
  where the resident stands now: the planner's Add step offers every kind of step, and one that
  acts on a place (work, build, fetch, store, pick up, feed the stable, breed, …) is picked on the
  map, with a walk there put before it. Adding only checks that the step could make sense (the place
  exists as last known, and is the realm's where it must be: a workplace or site anyone may work
  can be anywhere in sight or last seen); whether it can start is checked when its turn comes. A step that can't start or ends in a failure is skipped
  and noted in the realm log; when none of them can start, the queue ends. Any order that isn't a
  step ends it. Scripts see a resident's queue (which step, and what it is) but can't start or
  change one; their `order` and `script` stay the current step's own.
- **Saved queue:** the Player saves the planner's steps under a name, kept per browser like saved
  groups, so the server never sees them. The planner offers Save and Load; Load appends the
  saved steps to the planned ones. A saved step keeps its places (buildings, tiles); on Load, a
  step whose place is gone from the last-seen map is flagged in the planner, and the server
  skips it when its turn comes, as any step that can't start.
- **Planner clipboard:** steps are picked in the planner (tap; Shift for a range); Copy puts
  copies on a clipboard in the browser, Paste inserts them after the picked step, in the same
  planner or another resident's or a group's. The clipboard survives switching cards, not
  reloading the page.
- **Queue draft:** steps added in the planner for a resident with no queue collect as a draft, kept
  in the browser like a group's plan: nothing runs until the Player presses Start queue, which
  gives it. An order queued with Shift still starts a queue at once. A running queue is edited
  live as before; Edit as draft copies it into a draft, the queue runs on untouched, and Start
  queue replaces it (the step they are on keeps going if it is still in it). Discard draft throws
  the draft away. A draft is lost on reloading the page.
- **Clear:** the planner's Clear empties a draft. On a running queue it removes everything but
  the step the resident is on and turns loop off, so they finish that step and the queue ends;
  Stop is still how to halt at once.
- **Repeat block:** some steps in a row wrapped in a block, nestable, and part of the queue itself
  (ADR 0032): the server runs it and a running queue shows it with its round ("2 of 3"). It
  repeats a count of times, forever, or until a condition holds, checked before each round. A
  round in which no step could start ends the block, so a block never spins. A queue holds at
  most so many steps and blocks as written, and blocks nest only so deep (balance numbers); the
  planner says when a plan would exceed either. The whole-queue loop stays the queue's own
  switch, drawn as the outermost bracket.
- **If block:** a block with a condition, an optional Else part, nestable like a repeat block.
  When its turn comes the condition is checked once: true runs its steps, false its Else steps or
  nothing. It is not checked again while they run.
- **Wait until:** a step that ends once its condition holds; the resident stands idle meanwhile.
  With a duration it also ends when that is up.
- **Condition:** what a Wait until, an If block or a Repeat until asks. It is about the resident
  themself or one place of their own realm, never anything a Player couldn't know: they (or the
  carriage or vessel they drive) carry at least or less than so many of a good, or are full or
  empty; a storage, workplace pile or site of the realm, picked on the map, holds at least or
  less than so many of a good; their hunger or health is above or below a share; they are mounted
  or aboard, or not; the game hour is before or after an hour. A condition on a place that is
  gone or no longer the realm's counts as false and is noted in the realm log. In a group's plan
  each member checks it for themself. Scripts see the step a resident is on and its number among
  the steps counted top to bottom, as before; blocks, rounds and conditions they don't see.
- **Planner blocks:** the planner draws the queue as stacked blocks: a step is one line with its
  icon, the place by name (a building, waypoint or city; a bare tile as coordinates) and its
  duration only when it has or needs one; loop, repeat and If are brackets around their steps.
  Add step is a palette grouped as the Orders tab is (Move, Work & build, Goods, Scripts) plus
  Flow (Repeat, If, Wait until), and a step can be added between two others.

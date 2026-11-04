# A struck resident runs a defence script, then goes back to what they did

Status: decided (2026-10-30, with Daniel). Builds on ADR 0002 (orders plus scripts) and ADR 0009
(tasks run default scripts).

Today a blow gives the struck resident a built-in order: armed, an `attack` on the attacker;
unarmed, a `walkTo` home. Any other order ends a running script, so being hit ends whatever the
resident was doing, memory included, and a queue loses its step. Scripts also have no way to know
they are under attack: nothing in their view says who struck them.

## Decisions

- **Scripts see the last blow.** The resident view gets `struckBy` and `struckAt`; an army's view
  the same for its members. No event lists: a script compares `struckAt` to the tick.
- **A blow runs the resident's defence script.** The game ships a **Defend** default (armed:
  attack the attacker until they are dead, gone or out of sight; unarmed: walk home; ends once no
  blow has landed for a while). It is a default script like the others: each Player has their
  version in the Library. Residents of NPC cities run the game's Defend, so they behave as today.
- **The Player picks a defence script per resident.** On the card's Script tab or the group card,
  one of their scripts; cleared, it is Defend again. Kept per resident like any script.
- **It interrupts and hands back.** The resident's order, script (with memory) and queue step are
  kept aside while the defence script runs; when it calls `end()` they go on where they were. A
  struck resident whose defence script is already running isn't interrupted again. A Player order
  given meanwhile ends both.

## Alternatives

- **The script's request wins, built-in otherwise.** Let the running script see the blow and
  react; the built-in order only when it requests nothing. Every script would have to handle being
  attacked itself, and the defaults would need a copied "Under attack" piece each; a resident on
  a plain order would still lose it.
- **End the script, as today.** Simplest, but a struck miner forgets their task and a queue loses
  its place, so one bandit undoes an hour of planning.
- **A fixed end.** The game ends the defence script itself once no blow has landed for a while,
  whatever it does. Easier to reason about, but a script couldn't choose to pursue or to hold the
  gate; `end()` is how every other script says it is done.

## Changed on 2026-11-04, with Daniel

"A Player order given meanwhile ends both" held only until the next blow, which started the
defence script again: an order to get away was lost within ticks. Now what the Player gives under
attack isn't interrupted by further blows (`CONTEXT.md`: A Player's order under attack). An order
that ends by itself stands until done; what goes on until stopped holds until no blow has landed
for the calm time, or a resident sent to Work mid-fight would never defend themselves again. We
didn't make every order immune to blows, however old: a worker must still react to an ambush.

Defend also no longer abandons a carriage (`CONTEXT.md`: On a carriage under attack): the carriage
is the way out, so an unarmed driver drives on and an unarmed passenger stays aboard while it moves.

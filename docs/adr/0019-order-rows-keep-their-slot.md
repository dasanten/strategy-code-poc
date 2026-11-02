# Order rows keep their slot while a card is open

Status: decided (2026-11-02, with Daniel). Amends ADR 0012, which hid orders that can't be given.

ADR 0012 chose to leave out, not grey out, the orders a resident can't take right now, to keep
the card short. In the UX review of 2026-11-02 that turned out to move the rows under the
Player's cursor: when a resident starts walking or arrives, the orders above the one aimed at
disappear or appear, and the click lands on another order. The group card, built later, went its
own way with a cloud of buttons, some greyed, so the two cards read differently.

## Decisions

- **While a card is open, each order row keeps its slot.** An order that stops being possible
  stays in its row, greyed, with the reason on the row (as Relocate already does). An order that
  becomes possible is added at the end of its group. The rows are sorted afresh only when
  something else is picked: a different resident, a tile, nothing.
- **The group card uses the same rows** as a resident card: the same groups, labels and key
  hints, with the group's own reasons on greyed rows.
- **Escape leaves the top-most thing first:** pick mode, then an open panel on the card, then a
  tile card, then the resident or group card, then the drawer.

## Alternatives

- **Always show every order, greyed when impossible.** Never moves, but the card lists Mount
  horses, Board carriage and Climb a wall for a farmer in a city with no horse in sight; ADR 0012
  shortened the card for a reason.
- **Keep hiding, animate the change.** The rows still move; a Player aiming at a row still
  misses it.

## Why

Players spend most of their time picking a unit and giving it an order (ADR 0012). A row that
stays where it was while the Player looks at it is what a card is for. Sorting afresh on a new
selection keeps the card as short as before for the common case: the card opens with only what
the resident can do, and grows only while the Player watches.

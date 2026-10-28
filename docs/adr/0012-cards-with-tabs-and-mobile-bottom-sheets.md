# Cards with tabs, pick mode and mobile bottom sheets

Status: decided (2026-10-28, with Daniel).

The resident card had grown to every order, the queue, stats and params open at once, and on a
phone the card covered the map, so "walk to" was hard to use: there was nowhere left to tap.

## Decisions

- **One card layout** for residents, groups and armies: a header that always shows, and tabs under
  it (Orders, Queue, Stats, Script), one open at a time, the last one remembered per browser.
  Orders are grouped by kind; orders that can't be given right now are hidden, not greyed out.
- **Pick mode:** an order that needs a target shrinks the card to its header and shows a banner
  with Cancel until the target is picked; then the card comes back. Same on desktop and phone.
- **Phones** (narrow or touch): cards are bottom sheets with three heights (peek, half, full); the
  map takes touch gestures (pan, pinch, tap, long-press for the right-click menu) and a Select
  toggle in the HUD turns a drag into box-select; the HUD collapses into a menu button.

## Alternatives

- **A radial menu on the map** instead of an Orders tab: fast with a mouse, but many orders don't
  fit a ring and it is hard to hit on a phone.
- **A separate mobile UI:** two UIs to keep in step with every feature; one responsive layout is
  cheaper.

## Why

Players spend most of their time picking a unit and giving it an order. Keeping the map visible
while picking a target, and showing one thing at a time on the card, fixes both complaints
without changing the look of ADR 0008.

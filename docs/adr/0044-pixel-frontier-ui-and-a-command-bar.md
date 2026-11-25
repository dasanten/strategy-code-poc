# Pixel frontier UI: one pixel look, a command bar, a sidebar and a dock

Status: decided (2026-11-22, with Daniel). Replaces the screen layout and panel style of ADR 0008
and the card placement of ADR 0012; their other decisions stand (the board-game map, relationship
colours, zoom tiers, the art registry, tabs on cards, pick mode, bottom sheets on phones). Rules in
`docs/context/screen.md` under **Screen** and **Pixel frontier**; built in Epic 119. The design is in
`docs/design/pixel-frontier/`.

## Context

The dark translucent "command table" of ADR 0008 was picked before the game had its own art. Daniel
now draws the map in pixel art (ADR 0043), and the UI around it looks like another program. The
layout has also filled up: nine drawers on a rail, a card top right that hides the tile under it,
and a card that scrolls through thirty orders. Daniel asked for a completely new design that keeps
every screen and function.

## Decisions

- **One look for everyone: Pixel frontier.** Parchment panels with hard 2 px edges and no rounded
  corners or blur, wood header bars, the palette of the pixel art (EDG32), a pixel face for names
  and titles and a plain sans for everything a Player reads or presses. No theme switch: the old
  look is deleted when the epic lands.
- **The map's Art style stays a choice, and Pixel becomes its default** for whoever hasn't picked
  one. The UI look doesn't follow the Art style: a Player on Painted still gets the pixel UI.
- **A command bar along the bottom** holds the card of whatever is picked: header left, tabs and
  orders beside it, the minimap and map buttons at its right end. Orders are a grid with their
  keys, so the whole set shows without scrolling; ADR 0019 holds (rows keep their slot, greyed
  ones say why). In realm control mode (ADR 0041) the realm bar takes its place.
- **A sidebar with tabs** replaces the tool rail and its drawers: the same entries, groups and
  order, one open at a time, folding to its strip.
- **A dock on the right** takes tile cards, the who-list and realm order cards, so a tile and a
  resident can be open together. Panels an order opens appear above the command bar.
- **The Script library becomes a screen of its own**, the script workshop.
- **UI icons are drawn like the rest of the art:** a `ui` sheet in `art/pixel` with a named slice
  each. An icon not drawn yet shows a placeholder drawn in code, as a missing map sprite falls
  back to Painted.
- **Nothing is added or removed in this epic.** Functions the design sketches beyond what the game
  has (Find, idle and hungry buttons, list search, log filters, a saved groups strip, who runs a
  script) wait for an epic of their own.
- **Built on the epic branch, replacing the old UI there.** `dev` keeps the old UI until the whole
  epic merges; feature epics that land meanwhile are merged into the epic branch and restyled in
  it.

## Alternatives

- **Only the look, on today's layout.** Small and soon on `dev`, but the card top right and the
  scrolling order list, the things that are hard to use, would stay.
- **Both UIs behind a switch until the new one is complete.** Safer for `dev`, but every screen
  would exist twice for weeks and every feature ticket would have to touch both.
- **A UI theme that follows the Art style.** Three looks to keep in step with every feature.

## Why

Players spend their time picking someone and giving an order; a bottom bar with every order in
view and the map free above it serves that better than a card over the map. One look keeps every
later ticket single. Client only: no rule, format or script view changes (ADR 0002, 0006).

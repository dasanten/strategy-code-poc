# Game UI: board-game map, HUD over a full-screen map, SVG asset registry

Status: decided (2026-10-21, with Daniel).

The first UI read like a web dashboard: every map element was a coloured dot or square, and all
panels were stacked beside a map box. Players could not tell what things were. We redesign it as a
game screen.

## Decisions

- **Map look:** top-down 2D, a stylised board-game map. Terrain gets texture and edges between
  types; buildings, resource nodes, residents, carriages, armies and caravans are icon tokens
  whose **shape says what they are**. No isometric view: it would mean a new camera, picking and
  Region map for little gain at 3–48 px per tile.
- **Who owns a token** shows as a fixed **relationship colour** on its base: yours, alliance, other
  realm, NPC city, Trade Organization (your Leader also gets a crown). The Region map keeps one
  colour per Organization. No "enemy" colour: there is no war state, only standing.
- **Zoom tiers:** far shows terrain, territory and one emblem per city (sized by city size, with
  its name); middle shows building and node icons, residents grouped per tile with a count, carts
  and army banners; close shows single figures (up to 4 per tile, then +N) with an activity icon.
  The tier boundaries are tuning numbers.
- **Screen:** the map fills the screen. A top bar (realm, clock, status, key goods), a tool rail
  that opens one drawer at a time (Residents, Armies, Contracts, Alliance, Standing, Scripts, Realm
  log), a selection card whose actions depend on what is selected, and a large script editor.
- **Art pipeline:** one SVG per symbol in the repo, one registry mapping every game kind to its
  art (a test fails when a kind has none), rasterised into a Pixi texture atlas at load. The
  relationship colour is a tinted base layer, so one icon serves every owner. Painted sprites can
  replace the SVGs later by changing only what the registry points to.
- **Style** was picked by Daniel from a throwaway prototype with three directions (branch
  `t203-style-prototype`, variant D): **the painted board-game terrain, with the clean modern
  "command table" for everything else.**
  - Terrain: bright, saturated colours (Plains `#93c45a`, Forest `#3f8c3c`, Hills `#c9a65c`,
    Mountain `#938f8a`, Lake `#45aee0`, Sea `#2f80c6`), ragged organic edges between types, small
    dark marks (trees, hill arcs, peaks, waves) when zoomed in, and wide light roads (`#e8cf97`).
  - Tokens: buildings and city emblems are dark hex badges with a ring in the relationship
    colour and a light glyph; residents, carts and armies are dark round badges with the glyph
    and ring in the relationship colour; resource nodes are dark diamonds with the glyph in the
    node's colour. Walls are joined lines in the owner's colour. Counts are light pill badges.
  - Relationship colours: yours `#f2b630`, alliance `#4f9dff`, other realm `#ff6a48`, NPC city
    `#a89c8a`, Trade Organization `#2ec8b8`.
  - Screen: dark translucent panels, Inter type; a thin top bar (realm, clock, live status,
    goods, Leader), a narrow icon rail on the left with tooltips, a drawer sliding over the map
    (wide for scripts), an inspector docked top right with keyboard hints on its actions, and a
    zoom tier switch with a minimap bottom right.

## Why

Readability at 8–48 px per tile matters more than detailed art, and Claude can draw and tune a
consistent icon set in code but cannot make raster art. The registry keeps that choice
reversible. The redesign goes ahead of the remaining gameplay epics so that new features stop
landing in the old UI.

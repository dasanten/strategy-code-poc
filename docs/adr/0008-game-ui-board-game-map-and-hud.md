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
- **Style** is picked by Daniel from a throwaway prototype with three directions, built on the
  real map.

## Why

Readability at 8–48 px per tile matters more than detailed art, and Claude can draw and tune a
consistent icon set in code but cannot make raster art. The registry keeps that choice
reversible. The redesign goes ahead of the remaining gameplay epics so that new features stop
landing in the old UI.

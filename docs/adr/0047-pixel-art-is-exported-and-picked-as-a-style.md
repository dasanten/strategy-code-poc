# Pixel art is exported from Aseprite and picked as an art style

Status: decided (2026-11-21, with Daniel). Terms in `docs/context/screen.md` under **Art style**; how to draw
and export in `docs/art.md` under **Pixel art**; built in Epic 118. Numbered ADR 0043 until T124.4 (2026-11-27), which left 0043 to Creative mode.

## Context

Daniel draws the game's art himself, as pixel art in Aseprite, one piece at a time. The map had
two looks until now, with no choice between them: line art tokens (ADR 0008), and painted sprites
drawn over them wherever a sprite existed (`docs/art.md`). His art will stay incomplete for a
while, and new game kinds will keep arriving before their art does.

## Decisions

- **The Aseprite files are the source, in the repository** (`art/pixel/`). A script
  (`pnpm art:pixel`) exports them to PNGs the web app loads and to a list of named slices. The
  exports are committed, so building the game never needs Aseprite.
- **A slice's name is the asset.** The code asks for `house` or `wall-wood-corner`, never for a
  position on a sheet, so sheets can be rearranged and grown freely.
- **An empty slice falls back.** When the art loads, a slice with nothing drawn in it is left out,
  and whoever draws falls back to the painted look and then the token. So a new drawing shows up
  after an export with no code change, and a kind without art never draws as nothing.
- **Three art styles, picked by the Player per browser:** Tokens, Painted (the look until now, and
  the default) and Pixel. It is a setting, not a rule: nothing in the world depends on it.
- **16 pixels a tile, buildings seen from above, units from the front or the side.** One image per
  unit: no walking directions and no animation, for now.
- **Walls and roads are six pieces each, turned by the code** to their neighbours, so their
  shading has to be the same from every side. Gates are drawn in both directions, open and closed.
- **The owner's colour comes from a `tint` layer**, drawn in greys and coloured by the game, not
  from finding grey pixels: a stone wall is grey too. Where art has no tint, the token's ring or
  the building's plate still shows the owner.
- **Crisp up close, smooth far out.** The art is scaled without blurring when enlarged, and with
  blending when shrunk, where single pixels would otherwise flicker.

## Consequences

- Every new building, unit or good can ship without art, and gets it later by drawing a slice.
- The art's look depends on the code's turning and scaling; `docs/art.md` says what to keep to.
- Roads that join corner to corner have no piece and are bridged by a plain band.

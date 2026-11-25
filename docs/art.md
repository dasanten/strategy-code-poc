# Map art: painted sprites and pixel art

What it takes to replace the map's SVG glyphs with painted images (ADR 0008). The registry in
`apps/web/src/map/art.ts` points every game kind to one file, so images can be swapped in one at a
time.

## Base prompt

Fill in `{W}×{H}` and `{SUBJECT}` per image.

> Top-down orthographic game sprite for a 2D strategy board-game map, viewed straight from above
> with no perspective and no isometric angle. Stylised, hand-painted look like a premium
> board-game tile: chunky simple shapes, a bold readable silhouette, soft painted shading with
> light from the top-left, and a thin dark outline. Medieval, low-fantasy, wood and stone. Bright,
> saturated, warm colours that sit well on grass green #93c45a, forest #3f8c3c, sandy hills
> #c9a65c and grey stone #938f8a. Very little fine detail, so it still reads at 32 px. Transparent
> background, no ground or grass under the object, no drop shadow outside the footprint, no text,
> no people. The object fills a square footprint of **{W}×{H} tiles** edge to edge. Flags,
> banners and roof trim are painted **pure light grey/white** so the game can tint them in the
> owner's colour. Subject: **{SUBJECT}**.

Example: "a 2×2 smithy: a stone forge with a chimney and glowing embers, an anvil in the yard, a
wood pile".

Keep these the same in every prompt:

- **Straight top-down, never angled.** Footprints are square and never turned, and the map has no
  isometric view.
- **Light from the top-left** on every image.
- **Light grey for whatever shows the owner** (flags, banners, trim), so one image works for every
  relationship colour.
- **128 px per tile:** 1×1 = 128², 2×2 = 256², 3×3 = 384², 4×4 = 512².

## All-in-one prompt

One sprite sheet with every building and unit: 36 cells in a fixed order, so the code can cut it
up without labels. Lessons from the first town hall try: it came out angled, on a lime background
that had to be keyed out, with long shadows, trees and a person around it. The prompt rules those
out.

> Create ONE sprite sheet image for a 2D medieval strategy board game. A 6×6 grid of 36 equal
> square cells, each cell exactly the same size, with a thin gap between cells. Every cell holds
> one object, centred and filling about 90% of its cell.
>
> STYLE (same for every cell): strictly top-down orthographic view, the camera looking straight
> down from above. No perspective, no isometric angle, no three-quarter view, so you see roofs,
> not walls. Stylised hand-painted board-game look: chunky simple shapes, a bold readable
> silhouette, soft painted shading with light from the top-left, a thin dark outline. Medieval
> low-fantasy, wood, thatch and stone. Bright, saturated, warm colours that sit well on grass
> green #93c45a. Very little fine detail, so each object still reads at 32 px. Flags, banners and
> roof trim are pure light grey/white (the game tints them). All 36 objects share one consistent
> style, scale of detail and light direction.
>
> BACKGROUND: the whole sheet, including every cell and gap, is one flat solid magenta #FF00FF,
> with no gradient, no texture and no ground, grass or dirt under the objects. No cast shadows on
> the background; shading only inside the objects. No text, labels, numbers or borders. No
> people, trees or props outside the object itself.
>
> CELLS, row by row, left to right:
>
> Row 1: 1 town hall (central hall with a bell tower and a banner, small paved plaza), 2 house
> (small timber house with a thatch roof), 3 storage (barn with crates and sacks), 4 warehouse
> (large stone merchant depot with many crates), 5 farm (square field of tilled crop rows with a
> tiny hut in one corner), 6 stable (stable roof with a fenced paddock and hay).
>
> Row 2: 7 mine (timber-framed mine entrance in rock, ore cart, rubble), 8 quarry (square pit of
> cut stone blocks with a wooden crane), 9 lumber camp (log piles, chopping block, sawhorse), 10
> smelter (round clay furnace with glowing top and an ore heap), 11 mint (small fortified stone
> house with gold accents), 12 smithy (stone forge with chimney and glowing embers, anvil).
>
> Row 3: wooden palisade wall pieces, each filling its cell edge to edge so neighbouring pieces
> join seamlessly: 13 straight wall running left–right, 14 corner joining the right and bottom
> edges, 15 T-junction joining left, right and bottom edges, 16 cross joining all four edges, 17
> end piece joining only the right edge, 18 single standalone post.
>
> Row 4: 19 wooden gate in the palisade running left–right, 20 the same gate running top–bottom,
> then light packed-dirt road pieces (#e8cf97), filling their cells edge to edge so they join: 21
> straight road left–right, 22 corner joining right and bottom edges, 23 T-junction joining left,
> right and bottom edges, 24 cross joining all four edges.
>
> Row 5: 25 road end piece joining only the right edge, 26 construction site small (a few planks
> and a stone foundation), 27 construction site medium (foundation with wooden scaffolding), 28
> construction site large (bigger foundation, scaffolding, stacked materials), 29 construction
> site very large (wide foundation outline with scaffolding at the corners and material piles),
> 30 resident (a single small person seen from above, plain clothes, white/light grey sash).
>
> Row 6: 31 leader (the same person with a golden crown and a light grey cape), 32 carriage (a
> two-wheeled wooden cart with one horse hitched in front, seen from above, pointing up), 33 horse
> (one brown horse seen from above, pointing up), 34 caravan (a larger covered merchant wagon
> with turquoise #2ec8b8 canvas and one horse, pointing up), 35 army banner (a tall war banner on
> a pole with a light grey cloth, seen from above at a slight angle so the cloth reads), 36 pile
> of goods (a small heap of sacks, logs and stones on the ground).

After generating, cut the sheet into its 36 cells and key out the magenta. Each building is then
drawn across its footprint (see the table below); the construction sites go with footprints 1×1,
2×2, 3×3 and 4×4 in that order.

## Images

### Buildings

| File            | Footprint | Subject                                                         |
| --------------- | --------- | --------------------------------------------------------------- |
| town-hall       | 3×3       | Central hall with a bell tower and a banner, a small plaza      |
| house           | 2×2       | A small timber and thatch house, a small yard                   |
| storage         | 2×2       | Barn or shed, crates and sacks                                  |
| warehouse       | 3×3       | Big Trade Organization depot, stone, many crates, merchant feel |
| farm            | 4×4       | Tilled field rows, a small hut at one corner                    |
| stable          | 3×3       | Stable, paddock fence, hay                                      |
| training-ground | 3×3       | Fenced yard, a straw target, a weapon rack, a paved ring        |
| haven           | 3×3       | Shore yard: a slipway with a boat, a jetty, a shed, crates      |
| mine            | 2×2       | Mine entrance with timber frame, ore cart, rubble               |
| quarry          | 2×2       | Cut stone pit with blocks and a crane                           |
| lumber-camp     | 2×2       | Log piles, a chopping block, a sawhorse                         |
| smelter         | 2×2       | Clay furnace, smoke, ore heap                                   |
| mint            | 2×2       | Small fortified stone house with gold accents                   |
| smithy          | 2×2       | Forge, chimney, anvil                                           |
| wall            | 1×1       | Wooden palisade (pieces below)                                  |
| gate            | 1×1       | Wooden gate in the palisade; one east–west, one north–south     |
| road            | 1×1       | Packed light dirt road #e8cf97 (pieces below)                   |

- **Training ground and haven:** the buildings not in the sheet. Each is drawn by hand as
  `apps/web/src/assets/painted/<file>.svg` in the same style, and the registry points to
  it with `PAINTED_BUILDING_IMAGE`. Their sites still use the 3×3 site cell.
- **Wall and road pieces:** both join their neighbours, so each needs end, straight, corner,
  T-junction, cross and single post (6 each), asked for as one sprite sheet so they line up. A
  stone wall set for the Trade Org HQ is optional.
- **Construction sites:** one scaffolding/foundation image per footprint size: 1×1, 2×2, 3×3, 4×4.

### Resource nodes (1×1)

node-forest, node-stone, node-iron-ore (rusty red rock), node-gold-ore (rock with gold veins).

### Units

Small round tokens; change the prompt to "a small round token, top-down figure".

- person (resident), leader (crown), carriage (cart with its horse hitched), horse, caravan (Trade
  Org cart with turquoise cloth), army banner, boat (a rowing boat on water; for now the line art
  `assets/map/boat.svg` on a round badge, with no painted cell yet), ship (a sailing ship with a
  mast and two sails, on a bigger token than a boat; for now the line art `assets/map/ship.svg`).
- Optional: soldier (a person with a spear), child, and carriage empty / half / full (others see
  only how heavily a carriage is loaded).

### City emblems (far zoom)

village, town, large town, Trade Org HQ (round, ringed walls). At far zoom these are the only
thing shown, so detail pays off here.

### Goods

For the top bar, the inspector and piles: Food, Wood, Stone, Iron ore, Iron, Gold ore, Coins,
Spear, Sword, Shield, Armour, plus one pile of goods on the ground.

### Terrain (optional, last)

Terrain is painted in code with its own edges and marks. Painted textures would need to be
seamless and tileable at 128 px: Plains, Forest, Hills, Mountain, Lake, Sea, and unexplored/fog.

### Kept as SVG

The activity icons (walking, riding, carrying, working, fighting) and the token bases (hex, ring, round,
diamond): tiny UI markers that read better as line art.

**Minimum:** about 58 images (15 buildings, 12 wall and road pieces, 1 extra gate, 4 construction
sites, 4 nodes, 6 units, 4 emblems, 12 goods and pile); about 65 with the optional units.

## Pixel art

Daniel's own art (ADR 0043), drawn in Aseprite and kept in `art/pixel/`. The Player sees it with
the **Pixel** art style (`docs/context/screen.md`: Art style); whatever isn't drawn yet keeps the painted look.

### Files

| File                 | What is in it                                                                    |
| -------------------- | -------------------------------------------------------------------------------- |
| `buildings.aseprite` | Buildings, towers, construction sites, city emblems                              |
| `tiles.aseprite`     | Wall, gate and road pieces, resource nodes, the pile                             |
| `units.aseprite`     | Horse, carriage (alone and hitched), caravan, banner, vessels, siege machines    |
| `goods.aseprite`     | One icon per good                                                                |
| `resident.aseprite`  | One figure; a layer each for the body, the Leader's crown and each piece of gear |
| `ui.aseprite`        | The UI icons (ADR 0044), one tile each (below)                                   |

Each sheet has a locked `guide` layer (never exported), an `art` layer, and optionally a `tint`
layer. Each asset is a **named slice** (Slice tool, Shift+C); the name is what the code asks for.
`art/pixel/make-templates.lua` creates empty files with every slice; it never overwrites a file.

### Rules for drawing

- **16 px per tile.** A building's slice is its footprint: 32×32 for 2×2, 48×48 for 3×3, 64×64
  for 4×4.
- **Buildings from straight above; residents from the front; horses, carts, vessels and siege
  machines from the side**, all facing the same way.
- **Owner's colour on the `tint` layer**, in white and greys: white becomes the full colour, grey
  a shaded one. Everything else on `art` in its real colours.
- **Walls and roads: six pieces**, each drawn once and turned by the game: `end` joins right,
  `straight` left and right, `corner` right and bottom, `t` left, right and bottom, `cross` all
  four, `post`/`single` none. Where a piece joins, the same pixels must sit on the tile's edge on
  every piece. Keep the shading the same from every side, since pieces are turned.
- **Gates** are drawn four times per material: closed and open, in an east–west and a
  north–south wall. They are not turned.
- **Gear on the resident:** a layer named after the good (`sword`, `shield`, `armour`, `spear`,
  `bow`, `crossbow`), and `steel-…` for a steel one that should look different. Steel without a
  layer of its own shows the iron layer; gear with no layer at all keeps its small mark.
- **UI icons** are 16×16, drawn for a dark bar and for parchment alike (a dark outline helps),
  and shown at 16, 20, 24, 32 and 48 px, so whole pixels only.

### The `ui` sheet

One slice per UI icon, named for what it means. The game draws each from its slice once something
is drawn in it, and until then a placeholder (`apps/web/src/assets/ui/sprites.svg`).

| Row               | Slices                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| Sidebar tabs      | `residents` `horses` `armies` `diplomacy` `cities` `waypoints` `scripts` `realm-log`                 |
| Diplomacy's tabs  | `contracts` `demands` `direct-offers` `alliance` `standing`                                          |
| Orders and steps  | `walk` `gather` `build` `goods` `script`                                                             |
| Actions and marks | `close` `add` `check` `warning` `loop` `run` `stop` `clock` `find` `settings` `sight` `map` `health` |
| Things            | `crown` `banner` `city` `key` `book`                                                                 |

The resident, a horse, a carriage, a caravan and a sword in the UI come from the resident, units
and goods sheets, and a good's icon from the goods sheet, whatever the map's Art style; a good not
drawn yet keeps its line icon.

### Exporting

```
pnpm art:pixel
```

It needs Aseprite (set `ASEPRITE` to its executable if it isn't found) and writes
`apps/web/src/assets/pixel/*.png` and `apps/web/src/map/pixel-slices.ts`. Commit them with the
`.aseprite` files. A slice with nothing drawn in it is skipped when the game loads, so an export
of half-finished sheets is fine.

### Adding an asset

Draw it in a new slice, and if the code doesn't know the name yet, add it to
`apps/web/src/map/pixel-art.ts`. A different look by state (as the open gate or the hitched
carriage) is a slice of its own that the code picks. A new UI icon goes in `UI_ICONS` in
`apps/web/src/ui-icons.ts`, with a placeholder cell if it has one.

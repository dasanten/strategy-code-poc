# Map art: painted sprites

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

| File        | Footprint | Subject                                                         |
| ----------- | --------- | --------------------------------------------------------------- |
| town-hall   | 3×3       | Central hall with a bell tower and a banner, a small plaza      |
| house       | 2×2       | A small timber and thatch house, a small yard                   |
| storage     | 2×2       | Barn or shed, crates and sacks                                  |
| warehouse   | 3×3       | Big Trade Organization depot, stone, many crates, merchant feel |
| farm        | 4×4       | Tilled field rows, a small hut at one corner                    |
| stable      | 3×3       | Stable, paddock fence, hay                                      |
| mine        | 2×2       | Mine entrance with timber frame, ore cart, rubble               |
| quarry      | 2×2       | Cut stone pit with blocks and a crane                           |
| lumber-camp | 2×2       | Log piles, a chopping block, a sawhorse                         |
| smelter     | 2×2       | Clay furnace, smoke, ore heap                                   |
| mint        | 2×2       | Small fortified stone house with gold accents                   |
| smithy      | 2×2       | Forge, chimney, anvil                                           |
| wall        | 1×1       | Wooden palisade (pieces below)                                  |
| gate        | 1×1       | Wooden gate in the palisade; one east–west, one north–south     |
| road        | 1×1       | Packed light dirt road #e8cf97 (pieces below)                   |

- **Wall and road pieces:** both join their neighbours, so each needs end, straight, corner,
  T-junction, cross and single post (6 each), asked for as one sprite sheet so they line up. A
  stone wall set for the Trade Org HQ is optional.
- **Construction sites:** one scaffolding/foundation image per footprint size: 1×1, 2×2, 3×3, 4×4.

### Resource nodes (1×1)

node-forest, node-stone, node-iron-ore (rusty red rock), node-gold-ore (rock with gold veins).

### Units

Small round tokens; change the prompt to "a small round token, top-down figure".

- person (resident), leader (crown), carriage (cart with its horse hitched), horse, caravan (Trade
  Org cart with turquoise cloth), army banner.
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

The activity icons (walking, carrying, working, fighting) and the token bases (hex, ring, round,
diamond): tiny UI markers that read better as line art.

**Minimum:** about 58 images (15 buildings, 12 wall and road pieces, 1 extra gate, 4 construction
sites, 4 nodes, 6 units, 4 emblems, 12 goods and pile); about 65 with the optional units.

# Control: the screen

- **Sidebar:** the sidebar on the left (Screen) groups its tabs as People (Residents, Horses,
  Armies), Diplomacy and Realm (Cities, Waypoints, Scripts, Realm log). Diplomacy is one tab with
  a tab each for Contracts, Demands, Direct offers, Alliance and Standing. A tab's button on the
  strip and a Diplomacy tab show a mark while they hold something the Player hasn't seen: what a
  notice would announce, and new lines of the realm log. _Avoid:_ tool rail, drawer (the old
  layout's words).
- **Cities tab:** a tab of the sidebar (Realm) listing the cities the Player knows as Your cities, Others in sight and Last
  seen. A row shows the name, whose it is in that relation's colour, and for the Player's own
  cities residents against housing and the key goods in its storages. Opening a row centres the
  map on the city and outlines its area, as picking it on the map does, and shows it in sections:
  Overview (residents, housing, buildings by kind without walls and roads), Stock, Trade, Gates.
- **Realm log:** what happened in a Player's realm (residents going hungry, deaths, Food
  spoiling), shown only to that Player, also what happened while they were offline.
- **Screen:** how the game screen is laid out (ADR 0044, replacing the layout of ADR 0008 and
  0012; built in Epic 119). The map fills the screen, with four fixed places over
  it. The **top bar** (control mode, realm, clock, goods, Leader, Zeal, heir). The **sidebar** on
  the left: one tab each for the realm's lists, in groups (People, Diplomacy, Realm; see
  Sidebar), one open at a time, folding to its strip of tabs. The **command
  bar** along the bottom: the card of whatever is picked (a resident, a group, an army), its
  header on the left and its tabs beside it, and in realm control mode the realm bar in its place.
  The **map dock** bottom right, at the command bar's right end: the minimap and the map's
  buttons. The **dock** on the right: tile cards,
  the who-list and the realm order cards, so a tile and a resident can be open together. A panel
  an order opens (Goods, Build, Haul route, …) opens above the command bar. The Script library is
  a screen of its own over the map, the **script workshop**. On a phone the command bar is the
  bottom sheet (peek, half, full) and the sidebar is the menu, as before. Only the UI: every
  order, list and form stays what it was.
- **Pixel frontier:** the look of the whole UI (ADR 0044): panels, buttons and type drawn like
  Daniel's pixel art, in its palette, with hard edges and no rounded corners or blur. One look for
  every Player; the Art style picks only how the map is drawn. A UI icon (a sidebar tab, an order,
  a mark) comes from the `ui` sheet of `art/pixel`, and one not drawn yet shows a placeholder
  drawn in code. A good's icon in the UI comes from the pixel goods sheet whatever the Art style;
  a good not drawn yet keeps its line icon.
- **Resident card:** what the UI shows for a picked resident (and, laid out the same, a group or
  an army): a header that always shows (name, Doing, hunger and health, what they carry) and one
  open tab under it: Orders, Queue, Stats or Script. Orders are grouped by kind (Move, Work &
  build, Goods, Scripts). The card opens with only the orders they can take; while it stays open
  each row keeps its slot: an order that stops being possible greys out saying why, one that
  becomes possible is added at the end of its group, and the rows are sorted afresh only when
  something else is picked (ADR 0019). A group card has the same rows, with the group's own
  reasons.
- **Art style:** how the map is drawn, picked by the Player in the map's legend and remembered per browser (ADR 0047): **Tokens** (line art only), **Painted** (painted
  sprites where there are some, tokens otherwise) or **Pixel** (Daniel's pixel art, and the
  Painted look for whatever has none yet; the default since ADR 0044, for whoever hasn't picked
  one). It changes nothing in the world. In Pixel,
  walls and roads join their neighbours, a gate shows open or closed, a carriage shows with or
  without its hitched horse, and up close a resident wears their equipped armour, shield and
  weapon.
- **Goods on cards:** each kind of good has one icon. Every inventory a card or sidebar tab shows
  (what a resident carries, a carriage's load, a storage's or stable's stock, a workplace's pile,
  a site's materials, trade lists) is a compact grid of icon and amount, the name on hover or
  long-press; a resident's own food shows apart from the rest. Cards give facts as labelled rows
  and meters, not sentences: a carriage its load against capacity, its horse with hunger, driver
  and passengers, and its route as "A → B" with the current leg and arrival; a storage or stable
  its stock and who is on the way to it; a workplace its pile and crew; a site what it has
  against what it needs, per good. Doing lines and the realm log stay sentences.
- **Motion on the map:** the world moves once a tick, but the map shows it smoothly. A token on
  its way (walking, driving, riding along a path it was sent) moves steadily along that path at
  its current pace between ticks, across tile edges, without stopping at each tile, however many
  ticks a step takes on that ground. When the next state disagrees (it stopped, turned or was
  blocked) the token eases to where the world says it is. Any other token that changed tile
  glides from the old tile to the new one over the tick, and the tokens of residents at work move
  a little on their tile, so a crew looks busy rather than frozen. Pure drawing in the browser:
  the world and what it sends change nothing.
- **Way on the map:** while residents are picked (one, or each member of a group), the map draws
  the way each is going for any order that goes along a path: walk to, drive, haul, Store, Fetch,
  a road or wall line, going after someone. So a script that hands over to Fetch to get food
  shows its way too. A passenger's way is the carriage's they are aboard. It is drawn at every
  zoom tier; at the far tier as a thin line with its end marked.
- **Places of the picked:** while residents are picked, the buildings their script's params point
  at (workplace, storage, source, site, …) and the place their current order heads for (the
  storage a Fetch goes to) are outlined on the map in the way's colour. Pure drawing.
- **Planned building:** what the Player's residents are set to build but haven't laid out yet
  shows on the map as faint ghosts: the tiles still to build of every road or wall line they are
  on or have queued, and the footprint of every build they are ordered or queued to do. The
  picked residents' plans are drawn stronger. Only the owning Player sees them; pure drawing.
- **Picking a target:** an order that needs a tile or building (walk to, store at, build here)
  shrinks the command bar to the card's header and shows "Tap where …" with Cancel until the Player picks one
  on the map; then the card comes back as it was. On a phone every card is a bottom sheet (peek,
  half, full), one finger pans, pinch zooms, a tap picks, a long-press does what right-click does,
  and a Select toggle makes a drag pick a group. While the card is shrunk, the room it took
  stays dead: a click there does nothing. Before the pick, the map previews under the pointer
  what it would do: the way of a walk, drive or ride with its arrival estimate, the line of a road
  or wall with its tile count, the footprint of a building (marked where it doesn't fit), or the
  building a Store, Fetch or Work would use. On a touch screen the first tap shows the preview
  and the banner gains Confirm; a tap elsewhere moves the preview. Escape leaves the top-most
  thing first: pick mode, then an open panel on the card, then a tile card in the dock, then
  the card in the command bar, then the open sidebar tab.
- **Picking on the map:** what a click (or tap) picks on a tile, in this order: a resident of the
  Player's, then a building (a carriage or horse of the Player's with nobody on it counts as
  one), then the bare tile. A click on a stack of the Player's residents picks them all as a
  group; a stack with others' residents shows the tile card, which lists them. A click beside
  their tokens on a tile with another realm's carriage shows the tile card too, where it can be
  driven off (Stealing a carriage or horse). With a pointer, what a click would pick is outlined
  on hover.
- **Control mode:** how the Player gives orders, picked with a Unit | Realm switch that is always
  in the top bar (and the Tab key), kept per browser; a new Player starts in unit control mode. Only
  the UI (ADR 0041): either way the same order requests go to residents, and nothing new is kept
  in the world. **Unit control mode:** pick a resident, a group or an army, then say what they do,
  as everything above describes. **Realm control mode:** say what is to be done and where, then
  who does it. There a click on the map picks a building, else the bare tile; residents are drawn
  but not picked, and a drag picks no group. Picking a resident, a group or an army some other way
  (the Residents list, a saved group's key, the Armies tab) switches to unit control mode.
  Armies are commanded only in unit control mode.
- **Realm order:** an order given in realm control mode: every order of the group card that names
  a place or a building (build, a road or wall line, work, tear down, feed the stable, breed
  horses, teach, train, walk to, explore, relocate, store at, fetch from, a haul route, drive, row,
  board, run a script). The **realm bar**, in the command bar's place, starts those that begin with a kind or a
  place (Build with the Build menu, Build line, Walk to, Explore, Run script); the card of a
  picked building, carriage, vessel or tile (in the dock) starts those about it (Work here, Build this site,
  Tear down, Store here, Haul with this carriage, …). The target is picked as in Picking a target,
  with the same previews, and an order's own form (a haul route, Customise) comes before the
  who-list. Orders without a target (stop, drop, mount, equip, …) and fighting (attack, climb a
  wall) stay in unit control mode. Once confirmed, the order goes to those ticked exactly as the
  group card would send it (One command for a group), with one difference: for an order bound to
  the target's tile (work, board, …), a ticked resident who is elsewhere gets a queue, walk there
  and then the order, instead of being skipped.
- **Who-list:** the last step of a realm order: the realm's residents who could take it, the
  nearest to the target first, each with what they are doing and how long their way is. The game
  **suggests** by ticking the nearest idle ones; the Player changes the ticks or just confirms.
  With nobody ticked, Confirm is off; with nobody idle, nobody is ticked and the list says so.
  A busy resident can be ticked too: a Now / After switch on their row says whether the order
  replaces what they are doing or is appended to their queue (as Shift does on a card). After is
  offered only where there is something to append to: a queue, or a walk of their own, which
  becomes the queue's first step. A resident on a task or script without a queue (Work, a haul
  route given directly, another order) shows Now only, with the note "no queue to add to",
  because a new queue would end what they do at once. Those who
  can't take the order (children, a partner carrying a child, no way there) are listed last,
  greyed out, saying why. The list can be searched and filtered as the Residents list can, and it
  fits a phone screen.
- **Build menu:** every buildable kind as an icon with a short name, under group headings
  (Resources, Food and animals, Industry, City, Defence, Transport), all in sight without reading.
  Tapping one shows what it is for, what it costs and Build. A kind that can't go on this tile is
  dimmed, and tapping it says why. It is the same on a resident's card, a group card and the
  planner. Only the UI: where a kind may be built doesn't change.
- **Residents list:** the Residents tab of the sidebar opens fully, to a list of the realm's residents with their
  stats, skills, gear, what they carry and what they are doing. It can be searched by name, filtered
  (has weapons, idle, child, by city, and the like) and sorted by any column; the choice is kept per
  browser. Tapping a row opens that resident. **Pick these** picks everyone listed, or those ticked,
  as a Group on the map. Only the UI: nothing new is kept in the world. It works on a phone.
- **Notices:** what the HUD tells the Player unasked (the Horse offer, a Direct offer or demand sent
  to them, the pick banner, a group order's report, the first-day card, a wandering trader at one of their cities) shows in one lane under the top bar, over the map and never
  over the sidebar, the dock or the command bar. While the pick banner shows it replaces the others; they come back after.
- **First day:** a new realm's HUD shows a checklist card: claim the Horse offer, pick a
  resident, give them an order, open the Wiki. Each line is ticked when the game sees it done;
  the card goes for good once all are ticked or the Player dismisses it. Kept per Player, not per
  realm: a Player who dismissed it never sees it again, also after a Leader death.
- **Goods in the top bar:** the top bar shows the Food, Wood, Stone, Coal, Steel and Coins held in storages, for
  what is picked beside them: **Entire realm** (the default: every storage of the realm, outpost
  storages included) or one city of the realm by name. Stables, carriages and piles don't count. A storage out of sight
  counts with what the Player last saw in it (Last seen), and the total says so when part of it is
  that old.
  The pick is kept per browser; a city no longer the realm's goes back to Entire realm. Only the UI.
- **Minimap:** a small map in the map dock bottom right of the screen (ADR 0008, 0044): the Player's explored terrain
  at a glance with their home city, their other cities, their residents and carriages away from
  home and the cities they know (Last seen), each a dot in its relationship colour, and the
  current view as a rectangle; a click centres the map there. It folds to a button, remembered
  per browser, and is folded on a phone.
- **Region map:** the map's territory overlay (one colour per Organization, ADR 0008). It is
  the far zoom tier's look and comes on there by itself; at the middle and close tiers only
  territory borders are drawn, so the terrain stays readable. The Region map button forces the
  overlay on at any tier and shows that it is on.
- **Roads far out:** at the far zoom tier the map draws the roads the Player knows (in sight or
  last seen) as thin lines over the terrain, so the way between cities stays readable however far
  out; road sites are left out there.
- **Waypoint:** a named marker the Player puts on a tile (from the map's right-click or
  long-press, or a script's `addWaypoint`), seen only by that Player: on the map at every zoom
  tier, on the minimap, and in the Waypoints tab of the sidebar, where it can be renamed, centred on or
  removed. Kept in the world per Player, not per realm, so it survives a Leader death. A waypoint
  is a place like a tile: a walk-to target, a queue step's place, a `waypoint` script param.
  Scripts see their Player's waypoints and can add and remove them; a waypoint a script adds is
  noted in the realm log (who put it, its name and tile). A Player holds at most so many (a
  balance number); Explore marks its finds with them.

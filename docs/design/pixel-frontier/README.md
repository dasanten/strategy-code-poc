# Pixel frontier: the UI design (ADR 0044, Epic 119)

The source of the design canvas "Game UI Redesign" (Daniel's, at
https://claude.ai/artifact/4mjsVHHXVyMMrV1enK5kfB). Each `*.dc.html` is one artboard: plain HTML
with inline styles on top of `ui.css`. Read the markup for sizes, colours, spacing and wording;
nothing here is built or shipped.

- `ui.css`: the kit. The colour tokens (EDG32), the type, and every atom: panel, header bar,
  button variants, tabs, chip, meter, row, table, token, icon. Port this first (T119.1).
- `sprites.svg`: placeholder UI icons, 16 px, 10 × 4 cells. Goods, units and the resident use
  Daniel's sheets in `apps/web/src/assets/pixel/` instead (the `.i-…` rules at the end of
  `ui.css` show which cell is which).
- `map.src.svg`: the sample map behind the artboards (`@@BUILDINGS@@` and `@@TILES@@` stand for
  the two pixel sheets). Not part of the UI.
- `canvas.json`: the artboards with their titles and sizes.

## Artboards

| Artboard                                                          | Shows                                                                                    |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `System`                                                          | The kit: colours, type, controls, meters, icons, relationship colours                    |
| `Main`, `Game-Pick`, `Game-Group`, `Game-Region`                  | The game screen: resident picked, pick mode, group, Region map and legend                |
| `Game-Realm`                                                      | Realm control mode, and the top bar and sidebar groups as they are on `dev`              |
| `Card-Queue-Blocks`                                               | The queue planner as on `dev` (drafts, If, Wait until); `Card-Queue` is the older sketch |
| `Card-Stats-Script`                                               | Stats and Script tabs                                                                    |
| `Card-Panels`, `Card-New-Orders`                                  | Every panel an order opens, the Build menu, gear, vessels, siege, dialogs                |
| `Card-Tile`                                                       | Tile cards in the dock                                                                   |
| `Residents-Full`                                                  | The full Residents list                                                                  |
| `Side-Horses`, `Side-Armies`                                      | Sidebar, People                                                                          |
| `Side-Diplomacy`, `Side-Contracts`, `Side-Alliance`, `Side-Standing` | Sidebar, Diplomacy and its five tabs                                                  |
| `Side-Cities`, `Side-Cities-Trade`, `Side-Waypoints`, `Side-Log`  | Sidebar, Realm                                                                           |
| `Scripts`                                                         | The script workshop                                                                      |
| `Entry`                                                           | Log in, sign up, founding, realm ended                                                   |
| `Wiki`                                                            | The Wiki page                                                                            |
| `Admin-Map`, `Admin-Lists`, `Admin-Tick`                          | The admin panel                                                                          |
| `Phone-Map`, `Phone-Card`, `Phone-Menu`                           | The phone layout                                                                         |

## Reading it

- **The code on `dev` says what a screen does; the artboard says how it looks.** The first
  artboards were drawn from the UI of 2 November, so where an artboard lacks a control the game
  has, keep the control and style it from the kit. Never drop a function because the picture
  lacks it.
- **Sketched but not in this epic:** Find (Ctrl K), the idle and hungry buttons, search and filter
  fields in the Residents, Horses and Realm log tabs, the saved groups strip, "Who runs it" and
  the script and version counters in the workshop, the Wiki search, Settings. Leave them out.
- **Sample data is made up,** and `[N]`, `[COST]`, `[MIN LENGTH]` stand for numbers the game
  knows.

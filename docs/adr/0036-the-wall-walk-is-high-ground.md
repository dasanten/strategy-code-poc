# The wall walk is high ground

Status: decided (2026-11-15, with Daniel). Rules in `CONTEXT.md` under **Walls in combat** (Wall
walk, High ground, A tile breaks), **Wall / Gate** (Wood or stone) and **Tower**; built in Epics
105 (Walls that hold), 106 (Stone walls) and 109 (Towers).

Daniel, 2026-11-15: early cities shouldn't attack each other, because the walls and the high
ground should make it basically impossible. Until now a defender on their own wall only took a
quarter of each blow (`WALL_DEFENCE`) and could be struck from the next tile like anyone, so
enough attackers always won.

## Decisions

- **Up is a place of its own.** A resident on a wall, gate or tower tile is up; getting up or down
  is slow and only for the wall's side, and only back down to the side they came from. Paths count
  that time, so nobody goes up by accident.
- **Nobody on the ground strikes anyone up.** Those up strike down at the ground next to the wall.
  The ways in are to break the wall (while being struck from above), climb it (while being struck),
  shoot at the walk with bows (Epic 108, against the wall's cover), or a ram under its roof (Epic
  110). The wall's cover stays for whatever does reach those up.
- **Alternatives turned down:** keeping the quarter damage and only raising it (a big enough crowd
  still wins, and early cities have crowds of the same size); letting a Spear reach up (it would
  make the cheapest weapon the answer to every wall).
- **Stone is harder, not higher.** A stone wall has the same walk and the same high ground; it only
  holds out longer, so siege machines (Epic 110) are what it is for.

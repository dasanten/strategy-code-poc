# Zeal is spent by hand

Status: decided (2026-11-19, with Daniel). Rules in `CONTEXT.md` under **Zeal** and **Rallying
the crew**; built in Epic 116.

## Context

A review of the early game on 2026-11-19 found that being online gives a Player nothing: an order
given by hand does exactly what a script does (ADR 0002), a starting city has eight residents for
its first days, and the first house takes about two real hours. The best play is to give a few
orders and close the tab. Daniel wants something a Player does by hand that is far more
productive, so the early game goes faster for whoever is there and a session feels rewarding.

## Decisions

- **A pool the Player holds, apart from the world.** Zeal fills steadily in real time up to a cap,
  online or not, and a new Player starts with it full. So it rewards coming back, not staying
  online all night, and nobody is punished for sleeping.
- **Spent only where the Leader stands.** The Leader rallies the crew of the workplace or site
  they are at: that crew works three times as fast while the pool drains. The pool is not
  physical, but spending it is: the Leader has to walk there, does no work meanwhile and is
  exposed away from home.
- **By hand only.** No script call and no queue step. This is the one exception to ADR 0002
  ("orders only request what a script could"), and it is the point: a script would spend the
  pool the moment it fills, and being there would again give nothing.
- **Work and building only.** Output at a workplace and work on a site (building, tearing down,
  repairing). Not walking, carrying, training or fighting.
- **It matters early and fades.** One crew is half of a starting city's economy and a sliver of a
  big realm's, so the same rule speeds up the start without deciding the late game. No size rule
  is needed.

## Considered

- **Spent on any building in sight, from the map.** Easiest to use, but a second purely
  non-physical exception beside the stock floor (ADR 0003), and the Leader's place would not
  matter.
- **Fills only while online.** Rewards an open tab, not play.
- **Scripts may spend it.** Keeps ADR 0002 whole and removes the reason for the rule.
- **One fixed burst per click.** Simpler, but the Leader could walk off, so nothing ties the
  effect to a place.
- **A plain bonus while the Leader stands at a building, with no pool.** Fully physical and
  scriptable, but then the Leader is parked on the farm for ever and being online changes
  nothing.
- **The name Drive.** Dropped: Driving is the carriage skill and `drive` an action.

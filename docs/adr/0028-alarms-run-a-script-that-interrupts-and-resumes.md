# Alarms run a script that interrupts and resumes

Status: decided (2026-11-06, with Daniel). Builds on ADR 0002 (orders plus scripts), ADR 0015
(defence scripts) and ADR 0017 (capture by holding the town hall).

A Player's armed residents react only when struck. So one armed outsider who attacks nobody can
stand on a town hall and take the city in 10 game days, and a thief walks off unchallenged. Scripts
can't help: they can't see a theft, nor whether a tile is in a City area.

## Decisions

- **One Alarm script per resident**, picked like the Defence script. Four kinds of alarm run it:
  an outsider entering the City area, a theft seen, the town hall occupied, a wall or neighbour
  attacked. It interrupts and hands back as ADR 0015 lays out. Scripts read `me.alarm`.
- **On by default for armed residents at home.** They run the game's Alarm default unless the
  Player picks another script or None. Unarmed residents run one only if picked. The Players most
  at risk are the ones who would never find a picker.
- **Force against occupiers and known thieves at home is no crime**, the rule trading posts already
  have. Striking anyone else there stays a crime, so guards can't clear out peaceful visitors.
- **The default holds the hall against armed outsiders rather than attacking them.** A defender on
  the hall already blocks an occupation, at no cost in standing.
- **NPC villages, towns and self-managed cities run the same default.** Trading posts and the HQ
  keep their own rules.

## Alternatives

- **One script per event.** More control per event, but a picker per event on the card, and a new
  event means new UI. One script can branch on `me.alarm.kind`.
- **Checks in the script API only.** No interruption: running scripts look for intruders. Every
  default would need the same copied piece, which ADR 0015 already rejected for blows, and a
  resident on a plain order would never react.
- **Opt-in guards.** No surprises for existing setups, but a Player who never finds the picker
  still loses a city to one person standing on the hall.

## Consequences

- Armed workers at home leave their work when an armed outsider walks in, then go back. A Player who
  wants otherwise picks None or their own script.
- Noticing who entered an area runs for every city each tick, and has to stay cheap (ADR 0016): it
  is indexed once per tick and watched in tick health. Who is already inside is plain data on the
  city, so it bumps `WORLD_FORMAT_VERSION` (ADR 0006).

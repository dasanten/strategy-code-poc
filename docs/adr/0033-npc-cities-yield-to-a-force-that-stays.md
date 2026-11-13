# NPC cities yield to a force that stays, and lend only what they can spare

Status: decided (2026-11-12, with Daniel). Changes how ADR 0024's demands are answered by an NPC
city; rules in `CONTEXT.md` under **Respect**, **Persuading a city**, **Demand** and **Hiring from
an NPC city**; built in Epic 96.

An evaluation of the NPC planner found three cheap ways to take an NPC city. Respect counted every
resident with any weapon and every wall tile of the sender as 1, seen by any resident of the city
wherever they stood: nine peasants with spears, nine wall tiles, or the city's own scout passing a
Player's walled city were enough for a village of three soldiers to hand itself over. A demand was
answered from one look, at the next planning pass. And an NPC city lent every worker beyond a
quarter of its adults, with the best weapons and armour from its storage, to a hirer who could then
order them against it.

## Decisions

- **Only fighters near the city count, by strength.** The sender's armed residents in the city's
  area or in sight of it, seen by a resident at home, each weighed as combat does (weapon, armour
  and shield, Combat skill). The sender's walls don't count: a wall can't march. The city's side is
  its soldiers weighed the same way and its own walls and gates.
- **The force has to stay.** The city remembers since when a realm has outweighed it without a
  break. It yields to a demand, or asks to join, only after a set time; a break starts it again from
  nothing, like an occupation (ADR 0017). The demand shows the city wavering and the time left.
- **It lends only spare hands**, with gear only from its surplus, and nobody while it feels
  threatened: weighing a demand, its hall occupied, or the hirer's armed residents near.
- **Lent residents never act against their own city**, and never count as the hirer's fighters
  toward it.

## Alternatives

- **Keep the sender's walls, but only near the city.** A ring of cheap wall tiles beside a village
  would still do an army's work.
- **Answer at once.** Simpler, with nothing stored, but one strong army could collect several
  villages in a game day by walking through, and nobody could come to help.
- **Keep heads, raise the multiple.** Cheap weapons on untrained residents would still pass for an
  army.
- **Stop hiring from NPC cities.** Closes the abuse, but hiring is one of the few uses for a big
  city's idle hands.

## Consequences

- The city stores a time per realm: `WORLD_FORMAT_VERSION` goes up with a migration (ADR 0006).
- The balance numbers for yielding and joining are picked again, for strength in place of heads.
- Hiring from a busy village is often declined, and mercenaries may come unarmed.
- Bandits (Epic 16) judge respect their own way when they are built; nothing here decides that.

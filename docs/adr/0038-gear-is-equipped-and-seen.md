# Gear is equipped and seen

Status: decided (2026-11-15, with Daniel). Replaces "there is nothing to equip" in `CONTEXT.md`;
rules under **Equipment**, **Soldier** and **Weapons and armour**; built in Epic 107.

## Decisions

- **Three slots: weapon, shield, armour.** Only what is equipped counts in combat and makes a
  resident armed. A Bow or Crossbow leaves the shield slot empty.
- **Equipping is automatic into an empty slot**, so arming stays as cheap as before for Players and
  scripts (ADR 0002); swapping is an action that takes a few ticks.
- **Others see what is equipped**, never what is carried: a Player can judge an army or a wall's
  defenders by looking, which Respect and the NPC cities' judging already assumed.
- **Existing residents** get their best carried items equipped by the migration (ADR 0006).

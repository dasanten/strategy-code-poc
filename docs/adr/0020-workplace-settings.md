# Work settings belong to the workplace, per realm

Status: decided (2026-11-02, with Daniel). Builds on ADR 0014 (default script targets are params).

Script params are kept per resident and per script (`CONTEXT.md`: Script parameter). A crew of
six at one farm means picking the same `storage`, `foodAt` and `foodTake` six times, and a new
worker sent there starts with whatever they last used somewhere else. Players think of "how this
farm is worked", not "how Ana works".

## Decisions

- **A realm keeps settings for each workplace it knows** (and each construction site of a
  workplace kind): a work script and values for its params, set on the building's card. A
  workplace has no owner, so two realms working the same farm each keep their own; neither sees
  the other's.
- **Giving Work there runs the work script with the workplace's values.** The Before-it-starts
  form shows them; what the Player changes there becomes that resident's override.
- **Live, with overrides:** a param reads the resident's override, else the workplace's setting,
  else the script's default. Changing the workplace's setting reaches everyone working there
  without an override at once. Changing the work script switches everyone working there by it.
- **A work script is any of the Player's scripts that declares `param workplace: building`**, or
  the Work default.

## Alternatives

- **On the building itself, one set for whoever works it.** Simpler, but a rival crew would run
  on settings it can't see, and settings would change hands with the workplace.
- **Copied at start.** The workplace only pre-fills the form; afterwards each resident keeps their
  own copy. Easy, but changing the farm's storage would again mean visiting every worker.

## Why

Settings live where the Player thinks of them. Overrides keep the old per-resident power for the
odd one out. Keeping them per realm fits "a workplace has no owner" and Sight: nothing about a
realm's plans leaks to whoever else works the same node.

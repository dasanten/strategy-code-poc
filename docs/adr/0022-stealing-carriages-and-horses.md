# Driving off in a carriage steals it

Status: decided (2026-11-03, with Daniel).

Players could only drive their own carriages and ride their own horses, so the game itself stopped
what its Crime rules are built for: a carriage standing unwatched could have its goods stolen but
not the carriage. Daniel: why would the game stop you from stealing them?

## Decisions

- **Taking is the act.** Driving off in another organization's carriage, mounting its free horse,
  or hitching its horse to drive off steals it. There is no separate "steal" order.
- **It changes hands at once.** The carriage or horse joins the thief's realm when taken, a
  carriage with its load and hitched horse, and from then on is ordinary property of that realm.
- **One theft.** It is a Crime like any other, known through a witness, worth the carriage, the
  horse and the load. Taking back what was stolen from you is theft too.
- **Unattended and unguarded only.** Not while someone drives, rides or is aboard, nor while an
  armed resident of its owner is on the tile and none of the thief's realm is.
- **The loss shows at once, the thief doesn't.** The victim's realm log says it is gone and where
  it was last; who took it comes through a witness.
- **A caravan's carriage can be stolen** once its crew and escort are beaten. That robs the caravan
  (Guaranteed carriage), and the Trade Organization replaces carriage and horse.

## Alternatives

- **It stays the owner's while driven.** The thief can only drive it, with every load taken being
  a theft of its own, and no hauling, boarding or refilling. It also stays in the victim's lists
  wherever it goes.
- **It becomes the thief's once parked at home.** Gives the victim a chance on the way, but adds a
  state in between that every carriage rule has to know about.
- **Taking back your own is no crime.** It needs a record of what was stolen from whom on every
  carriage and horse. Only Player realms are ever robbed this way (NPC cities don't steal), and a
  Player's standing does nothing on its own, so the record would change almost nothing.

## Why

The orders stay what they were (ADR 0002): `drive` and `mount` keep their shape and scripts get
stealing without a new API. Changing hands at once means nothing else in the game has to know
about stolen property: a stolen carriage is a carriage.

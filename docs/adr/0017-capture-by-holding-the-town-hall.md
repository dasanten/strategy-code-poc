# A city is captured by holding its town hall for some game days

Status: decided (2026-10-31, with Daniel). Replaces the capture rule of Epic 10.

Until now a city fell the tick armed residents of one realm stood in its area and no defender was
left there (`captorOf`). A raid that caught the garrison out took a city at once, the town hall
played no part, and the owner had no time to answer.

## Decisions

- **Occupying the town hall is the only way to capture.** Armed residents of one realm on the
  town hall's tiles, no other realm's armed residents and no defender there. Held for a set
  number of game days without a break (10 to start, in `balance.ts`), the city joins that realm
  as before (`joinRealm`). Beating the defenders is not enough on its own.
- **Only the hall counts.** Defenders elsewhere in the city don't stop the clock; to stop it they
  come to the hall and fight. That makes the town hall the thing to defend and to hold.
- **A break loses the days.** The first tick the occupation doesn't hold, it ends and the next
  starts from nothing, so retaking the hall even briefly saves the city.
- **One realm at a time.** An ally of the occupier on the hall is another realm, so nobody
  occupies it, as two realms in a city blocked each other before. Allies settle between them who
  takes it.
- **Everyone learns of it.** The owner's realm log says when its hall is occupied and when the
  occupation is broken; anyone with the hall in sight sees who holds it and how long is left, and
  scripts see the same. The occupation is world state (`city.occupation`), so the world format
  version goes up with a migration (ADR 0006).

## Alternatives

- **A second way, beside today's.** Keep the quick capture once no defender is left and add the
  town hall as another way. Raids would still take cities in a tick, which is what this changes.
- **The hall and a clear city.** The clock runs only while no defender is left anywhere in the
  city. A single soldier hiding at the far wall would hold it off forever.
- **Paused, not lost.** A break pauses the clock and the same realm goes on from there later.
  Wearing a city down by hit-and-run would work, and defenders gain little by retaking the hall.
- **Allies count together.** The clock runs while any ally holds the hall and the city goes to
  whoever started. Needs a rule for who that is and when allies fall out mid-occupation.

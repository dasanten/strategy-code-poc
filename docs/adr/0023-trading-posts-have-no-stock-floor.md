# Trading posts have no stock floor

Status: decided (2026-11-04, with Daniel). Changes ADR 0003 for trading posts; the HQ keeps its
floor.

Every warehouse used to top itself up to a floor of every good each game day, so a trading post
could sell anything without anyone bringing it there. Wandering traders are meant to be what lets
posts handle goods they don't produce, and that means nothing if the goods appear anyway.

## Decisions

- **Only the HQ's warehouses top up.** A post's floor is no longer a refill. It stays as the
  amount its spare hands, caravan and wandering traders work toward.
- **Everything a post holds came physically:** from its workers, its caravan, wandering traders or
  people selling to it.
- **Wandering traders carry every good,** Food and Coins too, since nothing else gives a post those.
- **Stock already in a post's warehouse stays.** Worlds are never reset (ADR 0006).

## Why

It follows the core rule, and it makes regions differ: prices move with what actually reaches a
post, and robbing a trader hurts a real market. The HQ's floor still keeps a market of last resort
in the world, as ADR 0003 wants.

## Consequences

- A post can run dry, even of Food, so its soldiers can go hungry and it can fall. A raid can empty
  a region's market. That is meant, but it is the risk to watch: a long simulation test has to show
  posts staying supplied when nobody interferes.
- The floor goes last, after traders run, so no world spends time with empty posts.

## Alternatives

- **Floor only for what a post produces.** Safer, and it keeps Food flowing, but goods a post makes
  would still appear free.
- **Keep floors, traders only even out prices.** Safest for the economy, but you would barely notice
  when a trader is lost.

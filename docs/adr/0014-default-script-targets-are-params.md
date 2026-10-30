# Default scripts take their target as a param

Status: decided (2026-10-29, with Daniel). Builds on ADR 0009 (tasks run default scripts).

A task order hands its default script the target in the script's memory (`memory.workplaceId`,
`memory.stableId`, …) before it starts. The same script started any other way (Run script, or a
queue step that runs it) starts with empty memory, finds no target and does nothing, every tick:
a resident told to run Work while standing on a quarry stands there, and a queue waits on that
step forever.

## Decisions

- **The target is a param.** Work declares `workplace`, Tear down `building`, Feed the stable and
  Breed horses `stable`, Build `site` and Haul `carriage`. Giving the task from the UI fills it.
- **Unset means the one on the resident's tile** when the script starts, kept until it ends.
- **The target param is never kept** between starts, unlike other params: a kept workplace would
  send a resident started on the quarry back to the farm they last worked.
- **What a param can't hold stays with the order.** Laying out a new site (its kind and place)
  and a haul route (where to, which goods) still come only from the Build and Haul orders.
- **A script that can't do its job ends with a reason**, `end(reason)`, noted in the realm log,
  so a queue moves on to its next step.

## Alternatives

- **Keep the memory, add a fallback to the tile in each default.** Less work, but the target
  stays invisible on the card and can't be changed there, and Players' own scripts can't copy
  the pattern.
- **Keep the target like any other param** and rely on the fields shown before a script starts.
  Easy to miss, and a queue step shows no fields when it starts.

## Consequences

- Residents running a default today hold the target in memory; a world migration moves it into
  the param.
- The before-start fields (Epic 36) show the target too, empty meaning "the one they stand on".

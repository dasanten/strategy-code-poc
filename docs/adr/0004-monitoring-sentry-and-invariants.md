# Monitoring: Sentry, simulation invariants and tick health

Status: decided (2026-10-18, with Daniel)

- **Sentry** (hosted) collects exceptions from the server and the web client. Every server event
  carries the tick number, the world seed and the IDs of the entities involved.
- **Invariant checks** run inside the simulation: every tick in development, sampled in
  production. Examples: no negative stock, no resident on impassable terrain, carried weight within
  carry capacity. A violated invariant is reported to Sentry as an error even though nothing
  crashed.
- **Tick health:** tick duration and the counts of residents and actions are reported as
  performance data, with an alert when ticks approach the 1 s budget (e.g. above 800 ms). Since
  2026-10-31 (Epic 49) the duration covers the whole tick, broadcast and save included, and comes
  with how long each phase took (orders, queues, scripts, world with its NPC planning and walking,
  invariants, territory, sight, broadcast, save), so a slow tick names its slowest phase and a
  tick made cheaper is judged by numbers. It also counts how many times a side's sight was worked
  out (`sightBuilds`): about one per realm or NPC city looking per phase, so sight worked out per
  socket again would show.
- **pino** writes structured JSON logs on the server for detail once Sentry points somewhere.
- An in-game admin dashboard comes later.

## Why

In a persistent simulation the worst bugs don't throw: the world just quietly becomes wrong and
stays wrong. Treating broken invariants as errors makes them as visible as crashes. Sentry was
chosen over a self-hosted OpenTelemetry/Grafana stack because it needs minutes of setup and no
upkeep, which suits a PoC.

## Consequences

- Each new simulation rule should come with the invariants it guarantees.
- The Sentry DSN is configuration (an environment variable); without it, reporting is off and
  only logs are written.

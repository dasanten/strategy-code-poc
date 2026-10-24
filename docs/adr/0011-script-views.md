# Script views: what a script sees is declared, not the server's own objects

Status: decided (2026-10-24, with Daniel). Extends ADR 0002's plain-data game API to what queries
return.

Every kind of thing a script can get (`me`, a resident from `residents()`, a building, a city, a
pile, a node, a last-seen entry, …) has a declared **script view** (`CONTEXT.md`: Script view): a
fixed list of fields with a description each, kept as plain data in `packages/shared` beside
`SCRIPT_API`. The server builds every object a script gets _from_ its view, so a script sees
exactly those fields and nothing more. A field the Player isn't allowed to see is always there and
`null`, and its description says when. Until now scripts got the server's internal objects as
they were (`toValue(resident)`).

## Why

Daniel wants scripting to stop feeling like guessing: autocomplete for `me.` and `r.`, warnings for
unknown fields, and a Game API reference in the Wiki. All of them need to know what fields
exist. Players' scripts also run for months, through Leader deaths and while they are offline, so
whatever scripts can read is a promise. With the internal objects passed through, any refactor of
server types could silently break them.

## Considered options

- **Describe only:** declare the views for the editor and the Wiki, keep passing the internal
  objects, and test that the declared fields exist. Cheaper, but scripts could still rely on
  undeclared fields, and the editor and Wiki would not be the whole truth.
- **Separate views for one's own and others' things** (own resident vs seen resident). More precise,
  but `residents()` returns both, so the editor would mostly show the union anyway.

## Consequences

- Adding a field to a view is always fine. Renaming or removing one is a breaking change: it needs
  Daniel's say, and each Player whose scripts read it gets a realm-log note naming the field and
  the scripts.
- The first switch is such a change. Before it ships, a check over every active version in the live
  world lists the fields each one reads that the views don't declare, so we declare them or know
  exactly who breaks.
- The game's default scripts use only declared fields; a test checks that.
- A new field on a server type no longer reaches scripts by accident. Exposing it means adding it to
  the view, which also puts it in the editor and the Wiki.
- Scripts are still not typed as resident's or army's: the editor offers both APIs, marked.

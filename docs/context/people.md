# People

- **Player:** the human behind an account. Owns nothing physically; joins alliances. Not a thing
  in the world. Signs up with an invite code. _Avoid:_ user (in game rules), "the player" meaning
  the figure.
- **Admin:** an account with admin rights: creates invite codes, resets passwords, gives
  admin directives, offers horses again (Horse offer) and watches how long the live world's ticks
  take (the tick health), in an admin panel apart from the game.
  Being an admin has nothing to do with
  the admin's own Player: it gives them no power in the world, and they play like anyone else.
  The one exception is knowledge: the admin panel shows the whole world (the **admin map**), so
  admins can watch over it. That knowledge is the admin's, never their Player's: the game screen
  and their scripts still see only their Player's sight, and nothing in the admin panel acts in
  the world except admin directives.
- **Creative mode** (Epic 117, ADR 0043, settled with Daniel on 2026-11-21): a way for admins to
  test the game on their own machine without waiting. It exists only on a server started with
  `CREATIVE=1`, which the live game never sets; without it, every creative route refuses, admin or
  not. It is the one place where being an admin acts in the world, and it is for testing only,
  never play. With it on, an admin gets:
  - **Time controls**, for the whole world: **pause**, **step** one tick, a **speed** (normal, ×10,
    ×60 or as fast as the machine allows) and **skip ahead** a number of game hours or days, shown
    with its progress and cancellable. Every rule runs exactly as at normal speed, only sooner.
    A server always starts running at normal speed.
  - **Creative actions**, on any realm (the admin's own, other Players', NPC cities, the Trade
    Organization) and on unowned tiles: give or take goods in a city's storage or a carriage;
    **finish now** a building, a site, a road or wall line, or a training; add a Resident (age
    and skills picked) or a horse to a realm on a tile; heal, grow a child up or kill a Resident;
    move a Resident or a group to a tile at once (their way and work dropped, what they carry
    kept; never onto a tile a Resident may not stand on, such as water without a vessel); and
    **reveal**, which shows the admin the whole map in the game view, fog lifted, until switched
    off (kept by the server per admin session, never in the world: it changes neither the
    Player's sight nor what their scripts see). They are given by hand only: they are
    no order kind and no script call (ADR 0002 stays whole for Players).
  - **Checkpoints:** a named copy of the world saved and restored from the game view while the
    server runs. Restoring pauses the world, swaps it whole and reloads every client; accounts are
    kept.
  - **Test worlds:** a new, small world made by the same generator as the live one (terrain, NPC
    cities, Trade Organization and its posts, fewer of each), at a size and seed the admin picks,
    into its own database, ready in seconds.
  All of it shows only to admins on such a server: a **Creative bar** in the game view (time
  controls and checkpoints) and a **Creative** section on tile, Resident and building cards.
  Acting as another realm (giving its orders as if it were one's own) is left for later.
- **Wiki:** the game's rules and numbers for Players, readable by anyone, logged in or not, apart
  from the game. It states the rules in plain words with the game's current balance numbers and
  what follows from them (how many residents one farmer feeds, what a worker's day is worth), so
  Players can plan. It tells only what is true for everyone, never anything about the world's
  current state. _Avoid:_ help, manual, guide.
- **Leader:** the Player's figure in the world. A resident like any other (stats, food, can die),
  except that the Player controls their cities and residents only while their Leader lives.
  A Leader serves no one else: they are never hired out or handed over to an alliance army.
- **Zeal** (Epic 116, ADR 0042, settled with Daniel on 2026-11-19): a pool every Player holds,
  apart from the world, counted in game hours of rallying. It fills steadily in real time,
  whether the Player is online or not, up to a cap (balance numbers: about two real hours from
  empty to full), and a new Player starts with it full. It is the Player's, not the realm's: a
  Leader handover and a Leader death keep it. NPC cities and the Trade Organization have none.
  It doesn't fill while the Player's Leader is on the Rally the crew order, also in moments when
  nobody there works and nothing drains; it fills again from the moment the rally ends (Daniel,
  2026-11-20). The HUD shows how full it is. _Avoid:_ Drive (Driving is the carriage skill).
- **Rallying the crew:** an order for the Leader alone, given by the Player by hand: never from
  a script or a queue (ADR 0042, the one exception to ADR 0002). The Leader has to be at a
  workplace or a construction site (At a building). While they stay there on that order, every
  resident of their realm working that workplace, or building, tearing down or repairing at that
  site, does so at three times their pace (a balance number), and the Player's Zeal drains; it
  drains only while somebody is being rallied, and doesn't fill while the order runs. The Leader
  does no work of their own meanwhile.
  Only work is faster: not walking, carrying, fetching, training or fighting. It ends when the
  Player stops it or gives the Leader another order, when the Leader leaves the building or
  goes Down, or when the Zeal is used up; whatever Zeal is left stays. It counts as going on
  until stopped (A Player's order under attack; Daniel, 2026-11-25): a Leader struck while
  rallying defends themself and takes the rally up again once no blow has landed for the calm
  time, if still at the building; one given under attack holds until calm. The Leader's Doing line says "Rallying the crew", and the building's card shows its owning Player that the
  crew is rallied.
- **Leader handover:** the Player makes another resident their Leader while the old one lives,
  so the realm passes to a younger one. The new Leader is an adult of the realm who isn't serving
  anyone else (in a mercenary contract or the alliance army); both stand
  inside the same city of the realm when it happens, so a Leader out in the field comes home
  first. Only the Player chooses it (by hand or from a script); nothing else forces it. It is
  free and instant, also while the city is under attack. The old Leader stays on as
  an ordinary resident of the realm. Contracts, alliances, standing, scripts and the realm log
  belong to the Player and carry over; the realm log records the handover.
- **Heir** (settled with Daniel on 2026-11-14, Epic 103): one adult of the realm the Player names
  to carry it on, by hand or from a script, free, instant and from anywhere; naming another
  replaces them, and the Player can clear it. The heir lives in a city of the realm, isn't the
  Leader and serves no one else (the residents a Leader handover allows; the two need not stand in
  one city). It lapses, with a line in the realm log, when the heir dies, leaves the realm, becomes
  homeless, is lent out or handed to the alliance army, or becomes the Leader by a handover. Only
  the Player and their allies see who the heir is.
- **Leader death with an heir:** the heir becomes the Leader at once, a Down heir too. The realm
  goes on under its name, with its standing, contracts, alliance, scripts and realm log. Only the
  city the heir lives in stays the realm's, with its residents wherever they stand and what is in
  it; every other city becomes a self-managed city as below, holding the Player in good standing.
  The realm then has no heir until the Player names one. Leader and heir dying in the same tick
  is a Leader death without an heir.
- **Leader death:** without a living heir, the Player instantly loses control of everything they held, wherever the
  Leader was. Their cities become self-managed and the realm ends: its alliance membership,
  contracts and standing end with it. The Player respawns as a new Leader with a fresh starting
  city on their next login, founding a new realm: they give its realm name and their new
  Leader's name (one from the game they may keep); the starting city gets one from the game.
  Their realm log tells them how their Leader died and what became of each city, and where it
  stands, so they can find it again on the map.
- **Self-managed city:** a city with no living Leader in charge. It runs on its own behaviour and
  can be traded with, contracted, conquered or integrated by anyone, including its former Player.
  When a Leader dies, each of their cities becomes its own self-managed city, with the residents
  who live there (those away walk home; homeless ones join the nearest) and the horses and
  carriages nearest it. Lent and hired soldiers walk home, and the realm leaves its alliance.
  Each such city starts out holding its former Player in good standing, which fades like any
  standing.

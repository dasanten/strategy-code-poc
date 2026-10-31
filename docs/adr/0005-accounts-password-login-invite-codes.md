# Accounts: username and password, invite codes, cookie sessions

Status: decided (2026-10-18, with Daniel). Addendum 2026-10-30: login timing and back-off.

- Players log in with a **username and password**. Passwords are hashed with Node's built-in
  `scrypt`; no third-party login and no email.
- Signing up needs a single-use **invite code**. Admins create codes; there is no open sign-up.
- A login creates a **session**: a random token in an `httpOnly`, `SameSite=Lax` cookie (`Secure`
  in production), stored hashed in SQLite. It lasts 30 days and renews while in use. The
  WebSocket authenticates with the same cookie when it connects; without a valid session the
  socket is refused.
- **Admin** is a flag on an account. The first admin is created with a server command
  (`pnpm --filter @csp/server admin:create`); admins create invite codes and reset passwords.
- Login and sign-up are rate-limited per IP. Passwords need at least 10 characters.

## Why

The world holds up to ~50 Players and every account spawns a starting city on the map, so
sign-ups must be controlled: invite codes stop bots without a CAPTCHA. OAuth (Discord, GitHub)
would avoid storing passwords but needs an app registration, a public callback per environment
and a fake login for local dev and tests. Email magic links need an email provider from day one.
Username and password works offline in development and has no outside dependency.

## Consequences

- There is no self-service password reset; a forgotten password goes through an admin.
- Swapping in OAuth later only changes how a session is created; everything after the session
  cookie stays the same.

## Addendum (2026-10-30): login timing and per-account back-off

Epic 44 (server hardening, finding 8): a login for an unknown name used to return at once, while
one for a known name ran `scrypt`, so the response time told which names exist.

- **Unknown names cost the same as wrong passwords.** A login for a name that does not exist
  still verifies the password against a dummy hash, made once at startup with the same `scrypt`
  parameters as real ones. The error is the same `wrong-login` either way.
- **Per-account back-off.** After a handful of failed logins in a row for one name, that name
  refuses logins for a short wait that doubles with every further failure, up to a cap. The wait
  is per name, not per IP (the per-IP rate limit stays), and applies to unknown names too, so it
  tells nothing about which names exist. A refused login gets the `rate-limited` status with the
  same message as a wrong password. A successful login clears the failures.
- The back-off lives **in memory**: a restart forgets it, and it remembers a bounded number of
  names, dropping the oldest past that. The numbers (`LOGIN_FAILURES_BEFORE_BACKOFF`,
  `LOGIN_BACKOFF_MS`, `LOGIN_BACKOFF_MAX_MS`, `LOGIN_BACKOFF_TRACKED_NAMES`) are constants in
  `apps/server/src/auth.ts`.

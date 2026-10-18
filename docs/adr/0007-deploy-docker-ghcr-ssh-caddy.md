# Deploy to Daniel's server: Docker image, GHCR, SSH, Caddy

Status: decided (2026-10-18, with Daniel)

- One production world on Daniel's own server.
- Every push to `main` that passes CI builds a Docker image, pushes it to the GitHub Container
  Registry and deploys it over SSH with `docker compose pull && docker compose up -d`.
- The compose file runs the game server plus **Caddy** on ports 80 and 443, with automatic HTTPS
  for the configured domain. SQLite lives on a named volume.
- **Backups:** the server writes a consistent SQLite backup before running migrations on start
  and once a day, keeping 14 days in a backups volume. Copying them off the server is up to the
  server's own backup.
- Rolling back means deploying the previous image tag, then restoring the pre-deploy backup if a
  migration already ran.

## Why

Daniel wanted his own server rather than a platform. A pre-built image means production never
builds anything, so no toolchain is needed there and a build can't fail in production. A
self-hosted GitHub runner would avoid inbound SSH, but on a public repository it lets pull
requests from forks run code on the server. Caddy is the shortest way to HTTPS, and the
`Secure` session cookies (ADR 0005) need HTTPS.

## Consequences

- The server needs Docker with the compose plugin, and a DNS record pointing to it.
- GitHub needs these secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, plus
  `DEPLOY_KNOWN_HOSTS`. The domain and other settings live in `.env` on the server.

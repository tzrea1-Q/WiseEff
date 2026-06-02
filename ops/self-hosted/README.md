# WiseEff Self-Hosted Runtime

This directory contains the M6.1 single-Linux-server baseline. It is meant for a controlled self-hosted staging or pilot host, not broad production hardening by itself.

## Services

- `postgres`: PostgreSQL source of truth.
- `api`: WiseEff API, bound to `0.0.0.0:8787` inside the compose network.
- `worker`: dedicated log-analysis worker through `npm run worker:logs`.
- `web`: Vite preview serving the built frontend.
- `proxy`: Caddy reverse proxy and TLS termination.

## Start

```bash
cp .env.example .env
# Fill every blank secret and target endpoint in .env.
docker compose --env-file .env up -d --build
```

Then run the metadata gate from the repository root:

```bash
npm run selfhost:check
```

Run smoke against the target URL:

```bash
npm run selfhost:smoke -- --env-file ops/self-hosted/.env --base-url https://wiseeff.example.com --allow-only-blocked=deviceGateway
```

`--allow-only-blocked=deviceGateway` is acceptable only for a non-HDC self-hosted staging target after the other readiness gates are real, including `M5_BACKUP_RESTORE_DRILL_AT` from a completed backup/restore drill. Full pilot readiness still requires HDC evidence.

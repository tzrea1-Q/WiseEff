# Self-Hosted IP Lab Profile

> Chinese: [Chinese](ip-lab.zh-CN.md)

This profile is for a single Ubuntu (or similar) host that has an IP address and **no DNS name**. It generates secrets, serves WiseEff on HTTP (or Caddy internal TLS), bootstraps a local admin, and imports ChargeLab demo data so that admin can see it.

It is a **lab/demo** path. It does not replace the DNS + Let's Encrypt profile in `.env.example`, and it is not commercial-pilot or release evidence.

## Preconditions

- Docker Engine 20.10+ and Compose v2 or standalone `docker-compose` 1.28+.
- Ports `80` (and `443` if you choose `--tls-mode internal`) reachable by the browsers you will use.
- About 4 GB RAM for the first image build. The stack can run tighter after images exist, but a 1–2 GB host often OOMs during `vite build`.
- A git checkout of this repository on the server. Node.js is **not** required on the host.

Install Docker on a bare Ubuntu host before continuing: https://docs.docker.com/engine/install/ubuntu/

## One Command

Prefer the [setup wizard](setup.md). The IP lab flag path still works from `ops/self-hosted/`:

```bash
chmod +x scripts/setup.sh
./scripts/setup.sh --non-interactive --ip <server-ip>
```

`deploy-ip-lab.sh --ip <server-ip>` remains a compatibility wrapper for the same command.

Examples:

```bash
./scripts/deploy-ip-lab.sh --ip 203.0.113.10
./scripts/deploy-ip-lab.sh --ip 203.0.113.10 --tls-mode internal
./scripts/deploy-ip-lab.sh --ip 203.0.113.10 --admin-username admin.ops --admin-password 'ReplaceWithAStrongPassword'
```

The script:

1. Writes `ops/self-hosted/.env` (mode `600`) with expanded secrets and `http://<ip>` (or `https://<ip>`) URLs.
2. Checks Docker, required keys, Caddyfile selection, and memory.
3. Runs `./scripts/compose --env-file .env up -d --build`.
4. Waits for `http://127.0.0.1/health/live`.
5. Seeds M0–M3 demo data and creates or moves the lab admin into `org-chargelab` / ChargeLab with `admin` and `platform-admin` roles.

Open `http://<server-ip>` and log in with `WISEEFF_LAB_ADMIN_USERNAME` / `WISEEFF_LAB_ADMIN_PASSWORD` from `.env`.

`--tls-mode internal` uses a Caddy self-signed certificate. Browsers will warn; continue only on a host you control.

## Split Commands

```bash
./scripts/deploy-ip-lab.sh --ip <server-ip> init
./scripts/deploy-ip-lab.sh preflight
./scripts/deploy-ip-lab.sh up
./scripts/deploy-ip-lab.sh provision
```

From a machine that already has Node.js 22 and `npm ci`:

```bash
npm run selfhost:ip-lab:init -- --ip <server-ip> --env-file ops/self-hosted/.env
npm run selfhost:ip-lab:preflight -- --env-file ops/self-hosted/.env
npm run selfhost:check
```

## What This Profile Changes

| Item | IP lab | DNS / ACME profile |
| --- | --- | --- |
| Public URL | `http://<ip>` or Caddy `tls internal` | `https://<dns>` + Let's Encrypt |
| Caddyfile | `Caddyfile.ip-lab` or `Caddyfile.ip-lab-tls` | `Caddyfile.example` |
| Auth | `AUTH_PROVIDER=local` | local or OIDC |
| LLM | `XIAOZE_DETERMINISTIC=true` and `LOG_ANALYSIS_DETERMINISTIC=true` unless you fill live keys | live keys expected for `/health/ready` |
| Demo data | seeded and attached to the lab admin | manual `seed-demo-data.sh` plus org move |
| Secrets | generated, URL-safe, expanded in `DATABASE_URL` | operator-filled, including `${POSTGRES_PASSWORD}` interpolation |

Rebuilding is still required when `VITE_WISEEFF_API_BASE_URL` changes. Set `--ip` to the address browsers will type **before** the first `up --build`.

## Out Of Scope

- Installing Docker for you.
- Let's Encrypt or a public DNS name.
- OIDC / Keycloak.
- Backup/restore drills, automatic startup of the optional observability profile, or pilot-readiness evidence. Start monitoring separately with `./scripts/observability up`.
- Shipping well-known demo passwords (`WiseEff-Dev!`) on a production `NODE_ENV` host.

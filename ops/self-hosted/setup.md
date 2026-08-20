# Self-Hosted Setup Wizard

> Chinese: [Chinese](setup.zh-CN.md)

This is the operator entry for a self-hosted WiseEff host. It asks only human decisions, generates secrets, and can later change one section without rotating database passwords.

It does **not** claim commercial-pilot or release readiness.

This file covers first install and configuration only. For a checkout that is already running, use [Self-Hosted Upgrade](upgrade.md); do not use `setup.sh --force` as an upgrade because that path intentionally rotates data-store credentials.

## One Command

From `ops/self-hosted/` on a machine with a terminal:

```bash
chmod +x scripts/setup.sh scripts/doctor.sh
./scripts/setup.sh
```

Quick mode (the default on a fresh host) writes an IP lab HTTP profile, a generated admin password, ChargeLab demo seed, and deterministic LLM flags so `/health/ready` stays green without live keys.

Full mode also asks for TLS (HTTP, Caddy `tls internal`, or Let's Encrypt), whether to skip seed, and optional Xiaoze / log-analysis keys.

## Flags (same answers, no prompts)

```bash
./scripts/setup.sh --non-interactive \
  --profile ip-lab \
  --tls-mode http \
  --ip 203.0.113.10 \
  --admin-username admin.ops \
  --seed chargelab \
  --llm skip
```

DNS + Let's Encrypt:

```bash
./scripts/setup.sh --non-interactive \
  --profile acme \
  --host wiseeff.example.com \
  --tls-email ops@example.com \
  --seed chargelab \
  --llm skip
```

`--json` prints a summary. It does not turn off prompts. Scripts must pass `--non-interactive`.

## Change one section later

```bash
./scripts/setup.sh access
./scripts/setup.sh llm
./scripts/doctor.sh
```

Section updates keep `POSTGRES_PASSWORD` and MinIO secrets. `--force` on a full rewrite rotates those secrets and will not open the current database volume.

## Compatibility

`./scripts/deploy-ip-lab.sh --ip <addr>` still works. It calls this wizard with `--non-interactive --profile ip-lab`.

Machines that already have `npm ci`:

```bash
npm run selfhost:setup -- --profile ip-lab --ip <addr> --print-env
npm run selfhost:doctor -- --env-file ops/self-hosted/.env
```

Wizard copy follows `WISEEFF_SETUP_LOCALE` or `LANG` (`en`, `zh-CN`). Command names, env keys, and profile ids stay English.

## Preconditions

- Docker Engine 20.10+ and Compose v2 or standalone `docker-compose` 1.28+.
- A git checkout of this repository. Node.js is not required on the server.
- About 4 GB RAM for the first image build.

Installing Docker remains a separate step: https://docs.docker.com/engine/install/ubuntu/

## Out Of Scope

- A public `curl | bash` installer.
- Ubuntu Docker installation.
- OIDC / Keycloak.
- Backup mounts, automatically starting the optional observability profile, or pilot-ready claims. After setup, operators may run `./scripts/observability up` separately.

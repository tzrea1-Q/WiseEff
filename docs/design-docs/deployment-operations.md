# WiseEff Deployment And Operations Design

> Chinese: [Chinese](../zh-CN/design-docs/deployment-operations.md)

Date: 2026-05-25

## Environments

WiseEff expects local, staging, and production-like environments. Local can use mock/runtime shortcuts for development. Staging should be close to production and disable business mock data. Production-like deployments require real auth, database, object storage, worker, queue, monitoring, backups, and rollback evidence.

An optional **IP lab** profile under `ops/self-hosted/` covers a single Linux host that has an IP and no DNS name. It generates secrets, terminates HTTP or Caddy internal TLS, uses local accounts, seeds ChargeLab demo data, and is explicitly not a commercial-pilot or release-ready environment. The operator entry is the [setup wizard](../../ops/self-hosted/setup.md); profile details live in `ops/self-hosted/ip-lab.md`.

## Services

Deployment units include web, API, log worker, PostgreSQL, Redis/BullMQ, object storage, reverse proxy, observability stack, and optional HDC device gateway connectivity.

## Configuration

Configuration is injected through environment variables or a secure configuration system. Production-like modes must reject unsafe defaults such as mock runtime as business data, missing database, missing S3-compatible object storage, missing auth boundary, or unsafe Agent provider configuration.

## CI/CD And Release

CI should install dependencies, run tests, check contracts, build artifacts, and run documentation governance. Release candidates add self-hosted config checks, backup evidence, rollback planning, target synthetic acceptance, capacity checks, and observability review.

## Self-Hosted Source Upgrade

The current runtime now has a dedicated [one-command upgrade module](2026-08-20-self-hosted-one-command-upgrade-design.md) at `ops/self-hosted/scripts/upgrade.sh`. It makes the source-checkout path transactional at the operator seam: resolve one immutable commit, prebuild before downtime, quiesce writers, verify a PostgreSQL/object-store/Redis recovery point, recreate every service without deleting volumes, observe migration and health gates, and persist resumable recovery state. It remains separate from `setup.sh`; upgrade must not render `.env`, rotate credentials, or provision seed data.

## Health, Monitoring, And Evidence

Operations endpoints report liveness, readiness, metrics, pilot readiness, and release readiness. Xiaoze LLM readiness evidence can identify model id and base URL configuration status in readiness JSON; metrics use `wiseeff_xiaoze_llm_ready`. Target-environment claims require target evidence; local skips only prove scripts and wiring.

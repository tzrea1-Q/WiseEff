# WiseEff Deployment And Operations Design

> Chinese: [Chinese](../zh-CN/design-docs/deployment-operations.md)

Date: 2026-05-25

## Environments

WiseEff expects local, staging, and production-like environments. Local can use mock/runtime shortcuts for development. Staging should be close to production and disable business mock data. Production-like deployments require real auth, database, object storage, worker, queue, monitoring, backups, and rollback evidence.

## Services

Deployment units include web, API, log worker, PostgreSQL, Redis/BullMQ, object storage, reverse proxy, observability stack, and optional HDC device gateway connectivity.

## Configuration

Configuration is injected through environment variables or a secure configuration system. Production-like modes must reject unsafe defaults such as mock runtime as business data, missing database, missing S3-compatible object storage, missing auth boundary, or unsafe Agent provider configuration.

## CI/CD And Release

CI should install dependencies, run tests, check contracts, build artifacts, and run documentation governance. Release candidates add self-hosted config checks, backup evidence, rollback planning, target synthetic acceptance, capacity checks, and observability review.

## Health, Monitoring, And Evidence

Operations endpoints report liveness, readiness, metrics, pilot readiness, and release readiness. Pi-backed Agent provider evidence can identify provider format, Pi provider id, model, and prompt version in readiness JSON; metrics keep only low-cardinality provider labels. Target-environment claims require target evidence; local skips only prove scripts and wiring.

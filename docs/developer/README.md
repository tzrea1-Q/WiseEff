# Developer Docs

These docs are the daily development entry point for WiseEff. They are intentionally operational: a developer should be able to set up the workspace, understand runtime modes, choose verification commands, and know where deeper product or architecture documents live.

## Reading Order

1. [Local Development](local-development.md): local dependencies, `.env`, database seeds, API mode, worker, and frontend startup.
2. [Environment Variables](environment-variables.md): local, staging, production, object store, Agent, HDC, and smoke variables.
3. [Verification Matrix](verification-matrix.md): which command proves which scope of work.
4. [Frontend](../FRONTEND.md): frontend runtime and port/API boundaries.
5. [Architecture](../../ARCHITECTURE.md): high-level runtime and module map.
6. [API Docs](../api/README.md): authentication, errors, and examples.

## Current Baseline

M0-M5 productization work is merged in the repository history. The current code has mock and API frontend runtimes, modular backend APIs, PostgreSQL migrations, object-store and worker seams, simulator/HDC device gateway seam, deterministic/live Agent provider seam, OpenAPI contract checks, and M5 pilot-readiness gates.

The repository is ready for local API-mode development and controlled evidence collection. It is not safe to call an environment pilot-ready until target-environment staging, HDC, backup/restore, rollback, and live provider evidence are recorded.

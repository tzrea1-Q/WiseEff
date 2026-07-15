# Contributing

> Chinese: [Chinese](docs/zh-CN/root/CONTRIBUTING.md)

WiseEff changes should keep the product usable, testable, and auditable. Start with the repository maps, then use the focused developer docs for setup and verification.

## Start Here

1. Read [AGENTS.md](AGENTS.md) for repository routing and agent rules.
2. Read [docs/README.md](docs/README.md) for the knowledge-base map.
3. Use [docs/developer/local-development.md](docs/developer/local-development.md) to prepare the local runtime.
4. Use [docs/developer/verification-matrix.md](docs/developer/verification-matrix.md) to choose the right checks before finishing work.

## Local Setup

```bash
npm ci
copy .env.example .env
npm run dtc:bootstrap
npm run dtc:check -- --required
npm run db:migrate
npm run db:seed:m0
npm run db:seed:m1
npm run db:seed:m2
npm run db:seed:m3
```

`db:seed:m1` compiles the three full DTS project fixtures before writing parameter data. The seed therefore requires `dtc`; the bootstrap command installs it with Homebrew on macOS or the native package manager on supported Linux distributions.

Fill `AGENT_API_BASE_URL`, `AGENT_MODEL`, and `AGENT_API_KEY` in `.env` when testing live Xiaoze LLM behavior. The default `.env.example` profile prepares local PostgreSQL, local object storage, multi-protocol device gateway, production-mode local account auth defaults, and optional HMAC smoke inputs.

## Development Rules

- Keep edits scoped to the requested behavior.
- Preserve mock runtime for demos and tests unless a plan explicitly removes it.
- Production-oriented paths must use the API runtime, backend authz, validation, transaction writes, and audit evidence.
- Update the closest documentation when a behavior, runtime, environment variable, command, or acceptance rule changes.
- Do not claim pilot readiness from local skips. Record real target-environment evidence in [docs/generated/m5-pilot-acceptance.md](docs/generated/m5-pilot-acceptance.md).

## Plans And Docs

Non-trivial work needs an active plan under `docs/exec-plans/active/`. Every active implementation plan except `development-roadmap.md` must include:

- `## Documentation Impact Matrix`
- `## Documentation Update Gate`

Run:

```bash
npm run docs:check
```

before marking a plan complete.

## Verification

Use targeted tests while editing, then broaden according to risk:

```bash
npm test
npm run test:server
npm run build
npm run docs:check
```

Use the phase gates in [docs/developer/verification-matrix.md](docs/developer/verification-matrix.md) for M1-M5 work. Documentation-only changes should still run `npm run docs:check` and `git diff --check`.

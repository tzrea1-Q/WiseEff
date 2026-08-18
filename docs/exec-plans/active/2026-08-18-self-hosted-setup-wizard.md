# Self-Hosted Setup Wizard

> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-08-18-self-hosted-setup-wizard.md)

**Goal:** Give a self-hosted operator one TTY wizard that asks only human decisions, generates the rest, and can later change one section without rewriting the whole `.env`. Same answers must be expressible as flags for scripts and CI.

**Status:** Design only. Do not implement until this plan is accepted and the IP lab profile (`2026-08-18-self-hosted-ip-lab-profile.md`, PR #534) is on the implementation branch.

**Architecture:** Copy the OpenClaw / Hermes *wizard architecture*, not their personal-agent product. WiseEff remains a Docker Compose stack. Split install (host prerequisites) from onboard (answers → render `.env` → preflight → up → provision) from doctor (repair). Keep one TypeScript renderer as the source of truth. The bash entry is a prompt and orchestration layer for hosts that do not have Node.

**Tech stack:** bash TTY prompts, existing Compose / Caddy profiles, TypeScript answer model + env renderer + Vitest, optional later Ubuntu Docker bootstrap.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on `cursor/selfhost-setup-wizard-24de` checked out from latest `main` after the IP lab profile is available |
| Implementation agent | Must not push `main`, merge, or rewrite published history |
| Parent / cloud session | Review, open/update the GitHub PR, merge when approved |

This design-only change uses `cursor/selfhost-setup-wizard-plan-24de`. One implementation plan → one implementation branch.

## Prerequisite

The no-DNS IP lab profile must be present on the implementation branch:

- `ops/self-hosted/scripts/deploy-ip-lab.sh`
- `ops/self-hosted/scripts/ip-lab-profile.ts` (`render` / `evaluate`)
- `Caddyfile.ip-lab`, `Caddyfile.ip-lab-tls`, ChargeLab-aware provision

If #534 is not merged, rebase or cherry-pick that branch before coding. Do not re-implement secret generation or seed attach in the wizard.

## Research: how OpenClaw and Hermes do it

Sources reviewed 2026-08-18:

- OpenClaw: [install](https://docs.openclaw.ai/install), [CLI onboarding](https://docs.openclaw.ai/start/wizard), [`openclaw setup`](https://docs.openclaw.ai/cli/setup), [CLI automation](https://docs.openclaw.ai/start/wizard-cli-automation)
- Hermes: [quickstart](https://hermes-agent.nousresearch.com/docs/getting-started/quickstart), [installation](https://hermes-agent.nousresearch.com/docs/getting-started/installation), hosted `install.sh`, `hermes_cli/setup.py` on `main`

### Shared pattern

Both products split **install** from **onboard** from **repair**:

| Layer | OpenClaw | Hermes | Meaning |
| --- | --- | --- | --- |
| Install | `curl …/install.sh` installs Node + CLI; `--no-onboard` stops there | `curl …/install.sh` installs uv/Python/Node/ripgrep, clones, writes `hermes`; `--skip-setup` stops there | Host prerequisites only |
| Onboard | `openclaw onboard` (fresh `openclaw setup` falls through here) | `hermes setup` | Collect choices, persist config, start the runtime |
| Repair | `openclaw doctor`, `openclaw configure --section …` | `hermes doctor`, `hermes setup <section>`, `hermes config get/set` | Change one slice or diagnose without a wipe |

Both also share these interaction rules:

1. **First-run modes, not one giant form.** OpenClaw guided (detect + live completion) vs classic QuickStart / Manual / Import. Hermes Quick (Nous Portal) / Full / Blank Slate.
2. **Modular sections, same functions.** Hermes `SETUP_SECTIONS` is a list of `(key, label, fn)`. `hermes setup model` calls the same `setup_model_provider` as Full Setup. OpenClaw later changes go through `configure --section` or chat-hosted `configure …`, not a second implementation.
3. **Existing config is sacred.** Re-run keeps state. OpenClaw wipe is `--reset` / `--reset-scope full`, not a menu default. Hermes existing installs re-run Full with current values as defaults; `--reset` is explicit and backups `.yaml.bak.<timestamp>` first.
4. **TTY vs automation are different contracts.** No TTY → do not `read`. `--json` is an output format, not non-interactive. Scripts must pass `--non-interactive` (OpenClaw also requires `--accept-risk`). Every prompt has a flag.
5. **Secrets are masked; most values are generated.** Interactive API keys use a hidden prompt. Loopback tokens, ports, workspace paths, and tool defaults are filled in. Hermes splits secrets (`~/.hermes/.env`) from non-secrets (`config.yaml`).
6. **Doctor before more features.** Hermes recovery order is doctor → model → setup. OpenClaw refuses to continue onboarding over an invalid config and asks for `doctor` first.
7. **Copy can localize; keys cannot.** OpenClaw uses `OPENCLAW_LOCALE` / `LANG` for wizard prose (`en`, `zh-CN`, `zh-TW`). Commands, config keys, URLs, and IDs stay English.

OpenClaw-specific lessons worth keeping:

- Guided setup **proves** inference with a real completion and persists only the verified route. A failing re-check never silently replaces the saved model.
- Classic health check starts the Gateway and verifies reachability as the last step.
- Import / migrate is a first-class setup mode when another product is detected.

Hermes-specific lessons worth keeping:

- Installer detects `curl | bash` (stdin is not a TTY) and avoids `read -p` so `set -e` does not abort on EOF.
- Root Linux installs use FHS (`/usr/local/lib/…` + `/usr/local/bin/hermes`); data stays under `$HERMES_HOME`.
- `hermes update` detects git / Docker / Nix and prints the matching update command.
- Blank Slate **pins** a minimal surface so later updates do not turn features back on. That is the right instinct for WiseEff lab vs ACME vs OIDC: an explicit profile, not “copy the 100-line example and hope.”

### What not to copy

WiseEff is a multi-container enterprise app, not a personal agent CLI. Do **not** copy:

- Channels, skills, daemon installers, Tailscale, OAuth portals, or chat-hosted setup after an inference gate.
- A public `curl | bash` CDN installer as the first deliverable (no signed release URL; operators already clone this repo).
- Requiring a global Node/Python toolchain on the Ubuntu host just so the wizard can run. Docker is the WiseEff runtime.
- Asking the operator to type postgres/minio/redis/internal compose URLs.

## Current WiseEff gap

Today the operator still does one of:

- Hand-edit `ops/self-hosted/.env.example` (ACME / DNS, 100+ lines, interpolated `DATABASE_URL`).
- Call `deploy-ip-lab.sh --ip …` (flag-driven, almost no TTY, IP lab only).

Missing relative to OpenClaw / Hermes:

- One entry that asks questions when a TTY is present.
- Quick vs full vs keep-existing.
- Section reconfigure (`setup access`, `setup llm`) without rewriting secrets.
- `doctor` that speaks operator language (profile, URL, admin, LLM, compose health, `/health/ready`).
- A non-interactive contract that is the same code path as the wizard.
- Optional later: install Docker on a bare Ubuntu host.

## Design

### Command shape

Server path (no Node on the host):

```bash
cd ops/self-hosted
./scripts/setup.sh                 # TTY wizard, or flags
./scripts/setup.sh access          # one section
./scripts/setup.sh llm
./scripts/doctor.sh
```

Same answers without prompts:

```bash
./scripts/setup.sh --non-interactive \
  --profile ip-lab \
  --tls-mode http \
  --ip 203.0.113.10 \
  --admin-username admin.ops \
  --seed chargelab \
  --llm skip
```

Machines that already have `npm ci`:

```bash
npm run selfhost:setup
npm run selfhost:doctor
```

`deploy-ip-lab.sh` stays as a compatibility wrapper that calls `setup.sh --non-interactive --profile ip-lab …`. Do not keep a second env renderer.

`--json` prints a machine-readable summary. It does **not** turn off prompts.

### First-run modes

| Mode | Default when | What it does |
| --- | --- | --- |
| **Quick (recommended)** | No `.env`, TTY | IP lab + HTTP + detected host + generated admin password + ChargeLab seed + deterministic LLM |
| **Full** | Operator chooses it | Same sections as Quick, plus TLS choice (HTTP / `tls internal` / ACME), optional live LLM keys, optional skip seed |
| **Keep existing** | `.env` already present | Default. Show profile, public URL, admin username (never the password). Continue to preflight/up/provision. |
| **Section only** | `setup.sh <section>` | Re-run one section; preserve generated secrets. |

There is no Blank Slate equivalent that disables product modules. WiseEff profiles already pin surface area (`ip-lab` vs ACME). Do not invent a third “empty compose.”

`--force` / `--reset` is the only way to regenerate postgres/minio passwords. Interactive Full on an existing file must say that this will orphan the current database volume.

### Sections (same functions in Quick, Full, and later `setup.sh <section>`)

| Section | Key | Asks | Writes / derives |
| --- | --- | --- | --- |
| `profile` | Deploy profile | IP lab or DNS + Let's Encrypt | `WISEEFF_DEPLOY_PROFILE`, default TLS/Caddyfile |
| `access` | Public entry | IP or hostname; TLS mode; ACME email only for Let's Encrypt | `WISEEFF_SITE_HOST`, `WISEEFF_TLS_MODE`, `WISEEFF_TLS_EMAIL`, `WISEEFF_PUBLIC_URL`, `WISEEFF_CADDYFILE`, API/VITE/bridge public URLs |
| `admin` | First operator | Username; password (generate if blank); display name | `WISEEFF_LAB_ADMIN_*`; `AUTH_PROVIDER=local` |
| `seed` | Demo data | ChargeLab seed or empty | Provision flag, not a long env block |
| `llm` | Model access | Skip / Xiaoze / Xiaoze + log-analysis | `AGENT_API_*`, `LOG_ANALYSIS_*`, deterministic flags |

OIDC, backup mounts, observability compose, and Device Bridge pairing stay out of v1. Full Setup may show them as “later, not in this wizard.”

### Ask vs generate

**Ask (human decisions):**

- Profile, host, TLS mode, ACME email.
- Admin username / password / name.
- Seed yes/no.
- LLM skip or OpenAI-compatible base URL + model + API key (Xiaoze, optionally log analysis).

**Generate and never prompt:**

- `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, expanded `DATABASE_URL` (no `${POSTGRES_PASSWORD}` interpolation).
- Redis URL, queue prefix, internal MinIO endpoint, object-store path-style flags.
- Smoke / identity bearer placeholders (leave empty).
- Backup/restore template paths (keep the example; do not ask).
- `XIAOZE_DETERMINISTIC=true` and `LOG_ANALYSIS_DETERMINISTIC=true` when LLM is skipped, so `/health/ready` does not 503.

**Detect and offer as defaults:**

- First IPv4 from `hostname -I` or `ip route get`.
- Existing `.env` values on re-run.
- Docker / Compose presence (doctor + setup preflight). Refuse to prompt for postgres if Docker is missing; print the install hint instead.

### Three-layer implementation

```text
TTY / flags / answers file
        │
        ▼
 SelfHostAnswers   (only human decisions)
        │
        ▼
 renderSelfHostEnv (generalize ip-lab-profile.ts)
        │
        ▼
 ops/self-hosted/.env  →  evaluate  →  compose up  →  provision
```

1. **Answers model** in TypeScript (`SelfHostAnswers`). Bash may write a small `ops/self-hosted/.setup-answers.env` (no secrets except the ones the human typed). Do not treat the answers file as the runtime config.
2. **Renderer + evaluator** stay in TypeScript. Extend `ip-lab-profile.ts` into a profile-aware module rather than a second bash `cat > .env` heredoc. ACME profile must expand `DATABASE_URL` the same way IP lab already does.
3. **Wizard / doctor** are thin. Prefer bash `select` / `read -s` on the server. If Node is available, `npm run selfhost:setup` can use the same answers types. Do not fork prompt logic into two incompatible UIs; bash is canonical for the Ubuntu host, TypeScript tests the answers→env mapping.

If the host has Docker but no Node, rendering should run as a one-shot container (`node:22-alpine` or the API image once built) that reads answers and writes `.env`. Do not require `npm ci` on the server for the happy path.

### Interactive flow (Quick)

1. Confirm this is a lab/self-hosted host, not a claim of commercial-pilot readiness.
2. Detect Docker, disk, and a candidate IP. Fail closed with an install hint if Docker is missing (P1 does not install Docker).
3. If `.env` exists → Keep existing (default), section menu, or `--force` regenerate.
4. Otherwise Quick defaults: `ip-lab` + `http` + detected IP + `admin.ops` + generated password + ChargeLab seed + LLM skip.
5. Show a review screen (profile, URL, username, password once, seed, LLM mode). Confirm.
6. Render `.env`, preflight, `compose up`, provision, print login URL and doctor hint.

Full inserts TLS and LLM questions before the review screen. Live completion against `AGENT_API_*` is P2 and must not block a skip path.

### Non-interactive contract

- Missing required flags + no TTY → exit 2 with the flag list. Never hang on `read`.
- `--non-interactive` does not imply `--force`.
- Regenerating secrets requires `--force`.
- `--json` may be combined with either mode.

### Doctor

`./scripts/doctor.sh` (and `npm run selfhost:doctor`) should report, not silently fix:

- Profile / Caddyfile / public URL consistency.
- Expanded secrets (fail if `DATABASE_URL` still contains `${…}`).
- `AUTH_PROVIDER=local` for lab; ACME may still be local in v1.
- Deterministic LLM flags when keys are empty.
- `docker compose ps` and HTTP `/health/live`.
- `/health/ready` as informational (LLM skip must be ready; live LLM misconfig should name the missing family).

`--fix` is out of v1 except “rewrite derived URLs after an `access` change.” Use `setup.sh <section>` for repairs.

### Locale

Wizard prose may follow `WISEEFF_SETUP_LOCALE` / `LANG` (`en`, `zh-CN`). Command names, env keys, URLs, and profile ids stay English. This matches OpenClaw and this repo’s bilingual-docs rule.

## Scope

In scope (implementation, after this design is accepted):

- P1: TTY `setup.sh` + flag path for IP lab Quick/Full and ACME Full; review screen; keep-existing; ChargeLab provision reuse; tests for answers→env; bilingual operator entry.
- P2: `setup.sh <section>`, `doctor.sh`, optional live LLM probe, `deploy-ip-lab.sh` as wrapper.
- Docs + `selfhost:check` tokens for the new scripts.

Out of scope:

- Public hosted `curl | bash` installer.
- Ubuntu Docker installer (P3 / later; still a gap for bare metal, not required to land the wizard).
- OIDC / Keycloak wizard (M6.2).
- Backup volume mounts, observability compose, prebuilt images, pilot-ready claims.
- Conversational LLM-driven setup.
- Writing shared `WiseEff-Dev!` on `NODE_ENV=production`.

## Success Criteria

- `./scripts/setup.sh` on a TTY can produce a working IP lab `.env` without the operator editing keys by hand.
- `--non-interactive --profile ip-lab --ip <addr>` matches today’s `deploy-ip-lab.sh` result (expanded secrets, ChargeLab admin, deterministic LLM).
- Re-run without `--force` keeps postgres/minio passwords.
- ACME path asks host + email and still expands secrets.
- `setup.sh llm` can add keys later without regenerating DB passwords.
- `npm run test:scripts` covers answers parsing, render, and evaluate.
- `npm run selfhost:check` and `npm run docs:check` pass.
- Existing ACME `Caddyfile.example` path still works.

## Implementation Tasks

Design (this change):

- [x] Research OpenClaw and Hermes install/onboard/doctor behavior.
- [x] Write this plan and the Chinese companion.
- [x] Index the plan from `docs/PLANS.md` and the roadmap.

Implementation (later branch):

- [ ] `SelfHostAnswers` + profile-aware renderer/evaluator tests.
- [ ] `ops/self-hosted/scripts/setup.sh` TTY + `--non-interactive`.
- [ ] ACME render path with expanded `DATABASE_URL`.
- [ ] Section commands + doctor.
- [ ] Compatibility wrapper for `deploy-ip-lab.sh`.
- [ ] Operator docs (EN + ZH) and metadata gate.

## Verification

Design-only:

```bash
npm run docs:check
```

After implementation:

```bash
npm run test:scripts -- ops/self-hosted/scripts/
npm run selfhost:check
npm run docs:check
```

Target Ubuntu TTY evidence is recommended for P1 but is not a merge blocker if unit tests cover answers→env and the IP lab provision tests still pass.

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Review | `README.md`, `docs/README.md`, `AGENTS.md` | Implementation will point operators at `setup.sh`. Design-only: no change. |
| Planning docs | Update | this plan, `docs/PLANS.md`, `docs/exec-plans/active/development-roadmap.md` | Active plan + index. |
| Product specs | No change | `docs/product-specs/` | Operator tooling, not a product workflow. |
| Architecture docs | Review | `ARCHITECTURE.md`, `docs/design-docs/deployment-operations.md` | Implementation records the wizard as the self-hosted entry. |
| Quality/testing docs | Review | `docs/developer/verification-matrix.md`, `docs/developer/environment-variables.md` | New commands; no new business env keys beyond profile answers. |
| Reliability/runbooks | Review | `docs/RELIABILITY.md`, `docs/runbooks/self-hosted-runtime.md` | Implementation updates the start path. |
| Security/governance docs | Review | `docs/SECURITY.md`, `docs/security/secrets-management.md` | Generated secrets + masked input; no new authz model. |
| Frontend/design docs | No change | `docs/FRONTEND.md` | No UI change. |
| Generated artifacts | No change | | |
| References | No change | | |
| Self-hosted ops | Review | `ops/self-hosted/README.md`, `ops/self-hosted/ip-lab.md` | Implementation adds wizard entry; keep IP lab doc as the profile contract. |
| Chinese developer docs | Update | matching `docs/zh-CN/**` companions for every English page this plan updates | Required bilingual pairs. |

## Documentation Update Gate

- Design-only landing: `npm run docs:check` must pass; planning indexes and both plan files must exist.
- This plan cannot move to `completed/` until every Update/Review row is updated or recorded as unchanged with evidence, and P1 success criteria pass.
- Deferred: Ubuntu Docker installer (P3), live-target TTY recording (existing TD-022 class), OIDC section (M6.2).

## UI Interaction Automation Review

No user-facing product interaction changes. Login, seed visibility, and API origin resolution stay on existing local-account and production origin-fallback paths. No new acceptance requirement or operation IDs.

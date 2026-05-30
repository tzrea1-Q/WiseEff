# Verification Matrix

Use the narrowest command that proves the change while developing. Before finishing, broaden to the gate that matches the risk and touched surface.

## Common Commands

| Command | Proves | Use when |
| --- | --- | --- |
| `npm test -- path/to/test.tsx` | Focused frontend behavior | Editing a component, page, domain helper, or frontend runtime. |
| `npm run test:server -- path/to/test.ts` | Focused backend behavior | Editing server modules, scripts, migrations helpers, or docs governance script. |
| `npm test` | Frontend/unit suite | Frontend-affecting changes. |
| `npm run test:server` | Backend/unit suite | Backend-affecting changes. |
| `npm run test:all` | Frontend plus backend unit suites | Shared contracts or broad behavior. |
| `npm run build` | TypeScript and Vite production build | TypeScript, routing, shared type, or package changes. |
| `npm run docs:check` | Documentation governance | Any non-trivial plan or documentation structure change. |
| `git diff --check` | Whitespace safety | Before committing or handing off. |

`npm test` defaults `VITE_WISEEFF_RUNTIME_MODE` to `mock` so local `.env` API-mode settings do not leak into frontend unit tests. For an intentional API-mode unit test run, set `VITE_WISEEFF_RUNTIME_MODE=api` explicitly in the shell before invoking `npm test`.

## Milestone Gates

| Gate | Command | Requires | Use when |
| --- | --- | --- | --- |
| M1 parameter management | `npm run test:m1` | PostgreSQL and M0/M1 seeds | Parameter API/runtime changes. |
| M2 log analysis | `npm run test:m2` | PostgreSQL, local object store, M0-M2 seeds | Log upload, worker, object store, log UI/API changes. |
| M3 debugging | `npm run test:m3` | PostgreSQL, simulator gateway, M0/M1/M3 seeds | Debugging service/gateway/runtime changes. |
| M3.5 commercial readiness | `npm run test:m3-5` | PostgreSQL, object-store root, simulator gateway | Readiness, production config, leases, request/audit correlation. |
| M4 Agent | `npm run test:m4` | PostgreSQL, M0/M1 seeds | Agent API, tool, approval, provider, or frontend Agent changes. |
| M5 smoke | `npm run smoke:m5` | Live API URL by default; admin smoke token for pilot-readiness | Operations smoke against a running API. |
| M5 full pilot gate | `npm run test:m5` | PostgreSQL, live API, and target evidence inputs | Before claiming commercial pilot baseline in an environment. |

## Documentation-Only Changes

Run:

```bash
npm run docs:check
git diff --check
```

If documentation changes include the docs checker itself, also run:

```bash
npm run test:server -- scripts/check-doc-governance.test.ts
```

## Evidence Rules

- A local simulator test proves workflow shape, not real-device readiness.
- `M5_SMOKE_ALLOW_NO_API=true` is a documented local skip, not pilot evidence.
- HDC device-lab, backup/restore, rollback, live provider, and staging smoke evidence must be recorded in [../generated/m5-pilot-acceptance.md](../generated/m5-pilot-acceptance.md).
- Do not mark TD-019 complete until target-environment evidence exists.

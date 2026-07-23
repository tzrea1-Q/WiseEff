# Local demo credentials seed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In `NODE_ENV=development` only, M0 seed upserts fixed local usernames and a shared demo password for the seven ChargeLab personas so role-by-role UI testing does not require manual register/bootstrap.

**Architecture:** Add `seedLocalDemoCredentials(db)` next to local auth helpers; call it from `seedM0Foundation` after users/roles exist. Gate strictly on `NODE_ENV === "development"`. Reuse `hashLocalAccountPassword` / username validation; upsert `user_password_credentials` by `user_id`.

**Tech Stack:** TypeScript, Vitest, Postgres via existing `Database` seam, scrypt password hashes.

**Design:** [`docs/design-docs/2026-07-23-local-demo-credentials-seed-design.md`](../../design-docs/2026-07-23-local-demo-credentials-seed-design.md)  
**Chinese plan:** [`docs/zh-CN/exec-plans/active/2026-07-23-local-demo-credentials-seed.md`](../../zh-CN/exec-plans/active/2026-07-23-local-demo-credentials-seed.md)  
**Branch:** `feat/local-demo-credentials-seed`

## Global Constraints

- Shared password exactly: `WiseEff-Dev!`
- Usernames exactly: `xu.yun`, `zhao.heng`, `liu.min`, `wang.jie`, `chen.na`, `li.peng`, `sun.mei`
- Write credentials only when `process.env.NODE_ENV === "development"`
- Never weaken production seed (no demo passwords outside development)
- Do not change mock `activeRoleId`, OIDC, or `admin:bootstrap` semantics

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation | Work on `feat/local-demo-credentials-seed` from `main`; commit on the feature branch |
| Implementation | Must not push to `main`, open/merge PRs, or fast-forward local `main` |
| Parent / session owner | Review, open PR, merge, sync local `main` |

## File Structure

| File | Responsibility |
| --- | --- |
| `server/modules/auth/seedLocalDemoCredentials.ts` | Account table, password constant, gate, upsert |
| `server/modules/auth/seedLocalDemoCredentials.test.ts` | Unit tests for gate + username policy + SQL shape |
| `scripts/seed-m0.ts` | Call helper at end of `seedM0Foundation` |
| `server/scripts/seed-m0.test.ts` | Contract: development writes credentials; non-dev skips |
| `docs/developer/local-development.md` + ZH | Account table for operators |
| `docs/api/authentication.md` + ZH | Note development seed login path |
| This plan + ZH companion | Tracking |

---

### Task 1: `seedLocalDemoCredentials` helper (TDD)

**Files:**
- Create: `server/modules/auth/seedLocalDemoCredentials.ts`
- Create: `server/modules/auth/seedLocalDemoCredentials.test.ts`

**Interfaces:**
- Produces:
  - `LOCAL_DEMO_SHARED_PASSWORD = "WiseEff-Dev!"`
  - `LOCAL_DEMO_CREDENTIALS: ReadonlyArray<{ userId: string; username: string }>`
  - `shouldSeedLocalDemoCredentials(env?: NodeJS.ProcessEnv): boolean`
  - `seedLocalDemoCredentials(db: Database, env?: NodeJS.ProcessEnv): Promise<{ seeded: boolean; count: number }>`

- [ ] **Step 1: Write failing tests**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_DEMO_CREDENTIALS,
  LOCAL_DEMO_SHARED_PASSWORD,
  seedLocalDemoCredentials,
  shouldSeedLocalDemoCredentials
} from "./seedLocalDemoCredentials";
import { validateLocalAccountUsername, validateLocalAccountPassword } from "./localAccountCredentials";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";

function createFakeDb() {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const queryable: Queryable = {
    async query<Row>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
      calls.push({ text, values });
      return { rows: [], rowCount: 1 };
    }
  };
  const db: Database = {
    query: queryable.query,
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      return fn(queryable);
    }
  };
  return { db, calls };
}

describe("seedLocalDemoCredentials", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exposes seven fixed usernames and a password that pass local policy", () => {
    expect(LOCAL_DEMO_CREDENTIALS).toHaveLength(7);
    expect(LOCAL_DEMO_SHARED_PASSWORD).toBe("WiseEff-Dev!");
    validateLocalAccountPassword(LOCAL_DEMO_SHARED_PASSWORD);
    for (const row of LOCAL_DEMO_CREDENTIALS) {
      validateLocalAccountUsername(row.username);
    }
    expect(LOCAL_DEMO_CREDENTIALS.map((row) => row.username)).toEqual([
      "xu.yun",
      "zhao.heng",
      "liu.min",
      "wang.jie",
      "chen.na",
      "li.peng",
      "sun.mei"
    ]);
  });

  it("gates on NODE_ENV=development only", () => {
    expect(shouldSeedLocalDemoCredentials({ NODE_ENV: "development" })).toBe(true);
    expect(shouldSeedLocalDemoCredentials({ NODE_ENV: "production" })).toBe(false);
    expect(shouldSeedLocalDemoCredentials({ NODE_ENV: "test" })).toBe(false);
  });

  it("upserts credentials in development", async () => {
    const { db, calls } = createFakeDb();
    const result = await seedLocalDemoCredentials(db, { NODE_ENV: "development" });
    expect(result).toEqual({ seeded: true, count: 7 });
    const credentialCalls = calls.filter((call) => call.text.includes("user_password_credentials"));
    expect(credentialCalls).toHaveLength(7);
    expect(credentialCalls.map((call) => call.values[1])).toEqual([
      "xu.yun",
      "zhao.heng",
      "liu.min",
      "wang.jie",
      "chen.na",
      "li.peng",
      "sun.mei"
    ]);
    for (const call of credentialCalls) {
      expect(call.values[0]).toMatch(/^u-/);
      expect(String(call.values[2])).toMatch(/^scrypt\$/);
      expect(call.text.toLowerCase()).toContain("on conflict");
    }
  });

  it("skips writes outside development", async () => {
    const { db, calls } = createFakeDb();
    const result = await seedLocalDemoCredentials(db, { NODE_ENV: "production" });
    expect(result).toEqual({ seeded: false, count: 0 });
    expect(calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm run test:server -- --run server/modules/auth/seedLocalDemoCredentials.test.ts
```

Expected: FAIL (module missing).

- [ ] **Step 3: Implement helper**

```ts
import type { Database } from "../../shared/database/client";
import { hashLocalAccountPassword, validateLocalAccountPassword, validateLocalAccountUsername } from "./localAccountCredentials";

export const LOCAL_DEMO_SHARED_PASSWORD = "WiseEff-Dev!";

export const LOCAL_DEMO_CREDENTIALS = [
  { userId: "u-xu-yun", username: "xu.yun" },
  { userId: "u-zhao-heng", username: "zhao.heng" },
  { userId: "u-liu-min", username: "liu.min" },
  { userId: "u-wang-jie", username: "wang.jie" },
  { userId: "u-chen-na", username: "chen.na" },
  { userId: "u-li-peng", username: "li.peng" },
  { userId: "u-sun-mei", username: "sun.mei" }
] as const;

export function shouldSeedLocalDemoCredentials(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV === "development";
}

export async function seedLocalDemoCredentials(db: Database, env: NodeJS.ProcessEnv = process.env) {
  if (!shouldSeedLocalDemoCredentials(env)) {
    return { seeded: false, count: 0 };
  }

  validateLocalAccountPassword(LOCAL_DEMO_SHARED_PASSWORD);
  const passwordHash = await hashLocalAccountPassword(LOCAL_DEMO_SHARED_PASSWORD);

  for (const row of LOCAL_DEMO_CREDENTIALS) {
    validateLocalAccountUsername(row.username);
    await db.query(
      `
      insert into user_password_credentials (user_id, username, password_hash)
      values ($1, $2, $3)
      on conflict (user_id) do update set
        username = excluded.username,
        password_hash = excluded.password_hash,
        password_updated_at = now()
      `,
      [row.userId, row.username, passwordHash]
    );
  }

  return { seeded: true, count: LOCAL_DEMO_CREDENTIALS.length };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm run test:server -- --run server/modules/auth/seedLocalDemoCredentials.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/modules/auth/seedLocalDemoCredentials.ts server/modules/auth/seedLocalDemoCredentials.test.ts
git commit -m "$(cat <<'EOF'
feat(auth): add development-only local demo credential seeder

EOF
)"
```

---

### Task 2: Wire into M0 seed + contract tests

**Files:**
- Modify: `scripts/seed-m0.ts`
- Modify: `server/scripts/seed-m0.test.ts`

**Interfaces:**
- Consumes: `seedLocalDemoCredentials(db)` from Task 1
- Produces: `seedM0Foundation` always invokes the helper (helper itself gates)

- [ ] **Step 1: Extend `seed-m0.test.ts` with failing cases**

Add after existing tests (restore `NODE_ENV` in `afterEach`):

```ts
it("writes demo password credentials when NODE_ENV is development", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const { db, calls } = createFakeDb();
    await seedM0Foundation(db);
    const credentialInserts = calls.filter((call) => call.text.includes("user_password_credentials"));
    expect(credentialInserts).toHaveLength(7);
    expect(credentialInserts.map((call) => call.values[1])).toContain("xu.yun");
  } finally {
    process.env.NODE_ENV = previous;
  }
});

it("does not write demo password credentials outside development", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const { db, calls } = createFakeDb();
    await seedM0Foundation(db);
    expect(calls.some((call) => call.text.includes("user_password_credentials"))).toBe(false);
  } finally {
    process.env.NODE_ENV = previous;
  }
});
```

- [ ] **Step 2: Run — expect FAIL on development case**

```bash
npm run test:server -- --run server/scripts/seed-m0.test.ts
```

- [ ] **Step 3: Wire `scripts/seed-m0.ts`**

Import and call after admin binding:

```ts
import { seedLocalDemoCredentials } from "../server/modules/auth/seedLocalDemoCredentials";

// end of seedM0Foundation:
const demoCredentials = await seedLocalDemoCredentials(db);
if (demoCredentials.seeded) {
  console.log(`Seeded ${demoCredentials.count} local demo login credentials (development only).`);
} else {
  console.log("Skipped local demo login credentials (NODE_ENV is not development).");
}
```

Only log from `main()` if preferred to keep `seedM0Foundation` quiet in tests — then return the result and log in `main`. Prefer: helper returns status; `seedM0Foundation` returns void; `main` can call helper status again or have `seedM0Foundation` return `{ demoCredentials }`. Simplest: log inside `seedM0Foundation` only when `process.argv` is the CLI entry — skip that complexity; **do not console.log from foundation during unit tests** unless tests tolerate it. Use:

```ts
await seedLocalDemoCredentials(db);
```

and log only in `main` after re-checking `shouldSeedLocalDemoCredentials()`, or have foundation return the result:

```ts
export async function seedM0Foundation(db: Database) {
  // ... existing inserts ...
  return seedLocalDemoCredentials(db);
}

async function main() {
  // ...
  const demo = await seedM0Foundation(...);
  console.log(demo.seeded ? `Seeded ${demo.count} local demo login credentials.` : "Skipped local demo login credentials.");
}
```

Update any callers that expect void (only CLI + tests) — tests ignore return value.

- [ ] **Step 4: Run tests — PASS**

```bash
npm run test:server -- --run server/scripts/seed-m0.test.ts server/modules/auth/seedLocalDemoCredentials.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-m0.ts server/scripts/seed-m0.test.ts
git commit -m "$(cat <<'EOF'
feat(seed): attach development demo logins to M0 foundation

EOF
)"
```

---

### Task 3: Documentation + plan index

**Files:**
- Modify: `docs/developer/local-development.md`, `docs/zh-CN/developer/local-development.md`
- Modify: `docs/api/authentication.md`, `docs/zh-CN/api/authentication.md`
- Modify: `docs/PLANS.md`, `docs/zh-CN/PLANS.md` (add active plan bullet)

**Content to add (EN local-development, after M0 seed bullet):**

```markdown
### Development demo logins (API mode)

When `NODE_ENV=development`, `db:seed:m0` upserts local usernames and a shared demo password for ChargeLab personas. Use these only on local developer databases.

| Username | Persona |
| --- | --- |
| `xu.yun` | Admin (Xu Yun) |
| `zhao.heng` | Hardware User |
| `liu.min` | Software User |
| `wang.jie` | Hardware Committer |
| `chen.na` | Software User |
| `li.peng` | Hardware Committer |
| `sun.mei` | Software Committer |

Shared password: `WiseEff-Dev!`

Non-development seeds skip these credentials. Empty non-demo installs still use `npm run admin:bootstrap`.
```

Mirror in ZH. In authentication docs (local accounts section), one short paragraph pointing to the table and the development-only gate.

- [ ] **Step 1: Apply EN/ZH doc edits**
- [ ] **Step 2: Run `npm run docs:check`**
- [ ] **Step 3: Commit docs**

```bash
git add docs/developer/local-development.md docs/zh-CN/developer/local-development.md docs/api/authentication.md docs/zh-CN/api/authentication.md docs/PLANS.md docs/zh-CN/PLANS.md docs/exec-plans/active/2026-07-23-local-demo-credentials-seed.md docs/zh-CN/exec-plans/active/2026-07-23-local-demo-credentials-seed.md docs/design-docs/2026-07-23-local-demo-credentials-seed-design.md docs/zh-CN/superpowers/specs/2026-07-23-local-demo-credentials-seed-design.md
git commit -m "$(cat <<'EOF'
docs: document development-only ChargeLab demo logins

EOF
)"
```

---

### Task 4: Local verification

- [ ] **Step 1: Re-seed M0 under development**

```bash
NODE_ENV=development npm run db:seed:m0
```

- [ ] **Step 2: Confirm rows**

```bash
docker compose exec -T postgres psql -U wiseeff -d wiseeff -c "select user_id, username from user_password_credentials where user_id like 'u-%' order by username;"
```

Expected: seven rows including `xu.yun` … `sun.mei`.

- [ ] **Step 3: Login smoke (API)**

```bash
curl -sS -X POST http://127.0.0.1:8787/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"xu.yun","password":"WiseEff-Dev!"}' | head -c 400
```

Expected: JSON with `token` / user id `u-xu-yun`.

- [ ] **Step 4: Confirm production seed skips**

```bash
NODE_ENV=production npm run test:server -- --run server/scripts/seed-m0.test.ts
```

(Or rely on unit test already covering skip.)

---

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Developer local setup | Update | `docs/developer/local-development.md`, `docs/zh-CN/developer/local-development.md` |
| API authentication | Update | `docs/api/authentication.md`, `docs/zh-CN/api/authentication.md` |
| Planning index | Update | `docs/PLANS.md`, `docs/zh-CN/PLANS.md`, this plan + ZH |
| Design specs | Update | already written; keep in sync if constants change |
| Env example | No change | no new env var (gate is `NODE_ENV` only) |
| Security / runbooks | Review | `docs/SECURITY.md` — confirm no production credential claim; no change if already clear that demo seed is local-only |
| Architecture / AGENTS | No change | — |
| Product specs | No change | — |
| Browser acceptance | No change | login UX unchanged; credentials are seed data only |

## Documentation Update Gate

Blocking until Update/Review rows are done or recorded unchanged. Run `npm run docs:check` before marking complete.

## Verification (plan complete)

```bash
npm run test:server -- --run server/modules/auth/seedLocalDemoCredentials.test.ts server/scripts/seed-m0.test.ts
npm run docs:check
NODE_ENV=development npm run db:seed:m0
# login xu.yun / WiseEff-Dev! against local API
```

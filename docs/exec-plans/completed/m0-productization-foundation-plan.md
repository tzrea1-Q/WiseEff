# WiseEff M0 Productization Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the M0 productization foundation: a testable TypeScript API skeleton, database migration baseline, auth context endpoint, audit persistence boundary, frontend API runtime switch, and CI coverage.

**Architecture:** Keep the current Vite React app in place and add a focused `server/` modular TypeScript backend instead of restructuring the repository. The frontend keeps using existing domain and port boundaries while M0 introduces a production-ready API client seam and a mock/API runtime mode. Persistence starts with SQL migrations and a small database adapter so M1 can add real parameter workflows without replacing the foundation.

**Tech Stack:** React 19, TypeScript 5, Vite 7, Vitest 4, Node.js 22, PostgreSQL SQL migrations, `pg`, `tsx`, `dotenv`, `zod`, GitHub Actions.

---

## File Structure

- Modify `package.json`
  - Add scripts for API dev, API tests, full CI, and database migration.
  - Add backend runtime dependencies: `@types/node`, `dotenv`, `pg`, `tsx`, `zod`.

- Modify `tsconfig.node.json`
  - Include `server/**/*.ts`, `scripts/**/*.ts`, and `vitest.server.config.ts`.

- Create `vitest.server.config.ts`
  - Runs backend tests in a Node environment and excludes frontend DOM setup.

- Create `server/config/env.ts`
  - Reads and validates M0 environment variables.

- Create `server/shared/http/errors.ts`
  - Defines `ApiError`, `ApiErrorCode`, and JSON serialization.

- Create `server/shared/http/router.ts`
  - Provides a tiny Node HTTP router for M0 endpoints without committing to a web framework before the backend shape is clear.

- Create `server/shared/http/server.ts`
  - Creates the API HTTP server and wires module routes.

- Create `server/shared/database/client.ts`
  - Wraps `pg.Pool` and supports dependency injection for tests.

- Create `server/shared/database/migrations.ts`
  - Applies SQL migrations from `server/migrations`.

- Create `server/modules/auth/types.ts`
  - Defines backend auth context, role, and permission DTOs aligned with the frontend.

- Create `server/modules/auth/policy.ts`
  - Owns backend permission mapping and role comparison.

- Create `server/modules/auth/repository.ts`
  - Loads the current user and role bindings from the database.

- Create `server/modules/auth/routes.ts`
  - Implements `GET /api/v1/me`.

- Create `server/modules/audit/types.ts`
  - Defines audit event insert/query shapes.

- Create `server/modules/audit/repository.ts`
  - Inserts and queries audit events.

- Create `server/modules/audit/routes.ts`
  - Implements `POST /api/v1/audit-events` and `GET /api/v1/audit-events`.

- Create `server/app.ts`
  - Exports `createWiseEffServer()`.

- Create `server/index.ts`
  - Starts the API from the command line.

- Create `server/migrations/0001_m0_foundation.sql`
  - Creates organizations, users, roles, role bindings, and audit events.

- Create `scripts/migrate.ts`
  - Runs migrations using `DATABASE_URL`.

- Create `scripts/seed-m0.ts`
  - Seeds a local organization, roles, admin user, and initial role binding.

- Create `server/test/testClient.ts`
  - Provides request helpers for API route tests.

- Create `server/modules/auth/policy.test.ts`
  - Tests backend permission rules.

- Create `server/modules/auth/routes.test.ts`
  - Tests `GET /api/v1/me`.

- Create `server/modules/audit/repository.test.ts`
  - Tests audit insert/query behavior with a fake database adapter.

- Create `server/modules/audit/routes.test.ts`
  - Tests audit route permission behavior.

- Create `src/infrastructure/http/apiClient.ts`
  - Shared browser fetch client with WiseEff error mapping.

- Create `src/infrastructure/http/runtimeMode.ts`
  - Reads `VITE_WISEEFF_RUNTIME_MODE` and exposes `mock` or `api`.

- Create `src/infrastructure/http/authClient.ts`
  - Fetches `GET /api/v1/me` and maps it to frontend role/user context.

- Create `src/infrastructure/http/apiClient.test.ts`
  - Tests URL building, JSON parsing, and error mapping.

- Create `src/infrastructure/http/runtimeMode.test.ts`
  - Tests runtime mode parsing and production mock guard.

- Modify `src/App.tsx`
  - Add a narrow `HYDRATE_AUTH_CONTEXT` reducer action and a startup effect that uses `authClient` only in API mode.

- Create or modify `src/App.test.tsx`
  - Add coverage that API mode hydrates current user and active role from `/api/v1/me`.

- Modify `.github/workflows/ci.yml`
  - Run frontend build, frontend tests, backend tests, and migration smoke checks.

- Modify `README.md`
  - Add M0 local development commands and runtime mode explanation.

---

### Task 1: Add Backend Dependencies And Scripts

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.node.json`
- Create: `vitest.server.config.ts`

- [ ] **Step 1: Write the expected package script shape**

Patch `package.json` so the `scripts` block becomes:

```json
{
  "dev": "vite --host 127.0.0.1",
  "dev:api": "tsx watch server/index.ts",
  "build": "tsc -b && vite build",
  "test": "vitest run",
  "test:server": "vitest run --config vitest.server.config.ts",
  "test:all": "npm test && npm run test:server",
  "db:migrate": "tsx scripts/migrate.ts",
  "db:seed:m0": "tsx scripts/seed-m0.ts",
  "preview": "vite preview --host 127.0.0.1"
}
```

Add these dependencies:

```json
{
  "@types/node": "^22.15.24",
  "dotenv": "^16.5.0",
  "pg": "^8.16.0",
  "tsx": "^4.20.3",
  "zod": "^3.25.42"
}
```

- [ ] **Step 2: Install and update the lockfile**

Run:

```bash
npm install @types/node@^22.15.24 dotenv@^16.5.0 pg@^8.16.0 tsx@^4.20.3 zod@^3.25.42
```

Expected: `package-lock.json` updates and `npm` exits with code `0`.

- [ ] **Step 3: Extend the Node TypeScript project**

Patch `tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "noEmit": true
  },
  "include": ["vite.config.ts", "vitest.server.config.ts", "src/vite-env.d.ts", "server/**/*.ts", "scripts/**/*.ts"]
}
```

- [ ] **Step 4: Add the backend Vitest config**

Create `vitest.server.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts"],
    exclude: ["node_modules/**", ".worktrees/**"],
    pool: "threads"
  }
});
```

- [ ] **Step 5: Verify the new test command is wired**

Run:

```bash
npm run test:server
```

Expected: Vitest starts in Node mode and exits with code `0`. Until later tasks add backend tests, it reports no matching test files.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.node.json vitest.server.config.ts
git commit -m "chore: add m0 backend tooling"
```

### Task 2: Create Environment And Error Foundations

**Files:**
- Create: `server/config/env.ts`
- Create: `server/config/env.test.ts`
- Create: `server/shared/http/errors.ts`
- Create: `server/shared/http/errors.test.ts`

- [ ] **Step 1: Write environment tests**

Create `server/config/env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadServerEnv } from "./env";

describe("loadServerEnv", () => {
  it("loads defaults for local development", () => {
    const env = loadServerEnv({});

    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(8787);
    expect(env.MOCK_RUNTIME_ENABLED).toBe(false);
  });

  it("parses explicit API settings", () => {
    const env = loadServerEnv({
      NODE_ENV: "test",
      PORT: "9001",
      DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
      MOCK_RUNTIME_ENABLED: "true"
    });

    expect(env.NODE_ENV).toBe("test");
    expect(env.PORT).toBe(9001);
    expect(env.DATABASE_URL).toBe("postgres://wiseeff:wiseeff@localhost:5432/wiseeff");
    expect(env.MOCK_RUNTIME_ENABLED).toBe(true);
  });

  it("rejects production mock runtime", () => {
    expect(() =>
      loadServerEnv({
        NODE_ENV: "production",
        MOCK_RUNTIME_ENABLED: "true"
      })
    ).toThrow("MOCK_RUNTIME_ENABLED cannot be true in production");
  });
});
```

- [ ] **Step 2: Implement environment parsing**

Create `server/config/env.ts`:

```ts
import { z } from "zod";

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_URL: z.string().optional(),
  MOCK_RUNTIME_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true")
});

export type ServerEnv = z.infer<typeof rawEnvSchema>;

export function loadServerEnv(raw: NodeJS.ProcessEnv): ServerEnv {
  const env = rawEnvSchema.parse(raw);

  if (env.NODE_ENV === "production" && env.MOCK_RUNTIME_ENABLED) {
    throw new Error("MOCK_RUNTIME_ENABLED cannot be true in production");
  }

  return env;
}
```

- [ ] **Step 3: Write API error tests**

Create `server/shared/http/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiError, serializeApiError } from "./errors";

describe("ApiError", () => {
  it("serializes known errors with request id", () => {
    const error = new ApiError("FORBIDDEN", "Admin access required.", 403, { action: "admin.access" });

    expect(serializeApiError(error, "req-1")).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Admin access required.",
        details: { action: "admin.access" },
        requestId: "req-1"
      }
    });
  });

  it("hides unknown internal error details", () => {
    expect(serializeApiError(new Error("database password leaked"), "req-2")).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error.",
        details: {},
        requestId: "req-2"
      }
    });
  });
});
```

- [ ] **Step 4: Implement API errors**

Create `server/shared/http/errors.ts`:

```ts
export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "PROCESSING"
  | "RATE_LIMITED"
  | "AGENT_TOOL_FAILED"
  | "DEVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function serializeApiError(error: unknown, requestId: string) {
  if (error instanceof ApiError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        requestId
      }
    };
  }

  return {
    error: {
      code: "INTERNAL_ERROR" as const,
      message: "Internal server error.",
      details: {},
      requestId
    }
  };
}
```

- [ ] **Step 5: Verify**

Run:

```bash
npm run test:server -- server/config/env.test.ts server/shared/http/errors.test.ts
```

Expected: both test files pass.

- [ ] **Step 6: Commit**

```bash
git add server/config/env.ts server/config/env.test.ts server/shared/http/errors.ts server/shared/http/errors.test.ts
git commit -m "feat: add server env and error foundations"
```

### Task 3: Build Minimal HTTP Router And Server

**Files:**
- Create: `server/shared/http/router.ts`
- Create: `server/shared/http/router.test.ts`
- Create: `server/shared/http/server.ts`
- Create: `server/app.ts`
- Create: `server/index.ts`
- Create: `server/test/testClient.ts`

- [ ] **Step 1: Write router tests**

Create `server/shared/http/router.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiError } from "./errors";
import { createRouter } from "./router";

describe("createRouter", () => {
  it("routes by method and path", async () => {
    const router = createRouter();
    router.get("/api/v1/health", async () => ({ status: 200, body: { ok: true } }));

    const response = await router.handle({
      method: "GET",
      path: "/api/v1/health",
      headers: {},
      requestId: "req-1",
      body: undefined
    });

    expect(response).toEqual({ status: 200, body: { ok: true } });
  });

  it("returns 404 for missing routes", async () => {
    const router = createRouter();

    await expect(
      router.handle({
        method: "GET",
        path: "/missing",
        headers: {},
        requestId: "req-1",
        body: undefined
      })
    ).rejects.toMatchObject(new ApiError("NOT_FOUND", "Route not found.", 404));
  });
});
```

- [ ] **Step 2: Implement the router**

Create `server/shared/http/router.ts`:

```ts
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RouteRequest = {
  method: HttpMethod;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  requestId: string;
  body: unknown;
};

export type RouteResponse = {
  status: number;
  body: unknown;
};

export type RouteHandler = (request: RouteRequest) => Promise<RouteResponse>;

import { ApiError } from "./errors";

function key(method: HttpMethod, path: string) {
  return `${method} ${path}`;
}

export function createRouter() {
  const routes = new Map<string, RouteHandler>();

  function add(method: HttpMethod, path: string, handler: RouteHandler) {
    routes.set(key(method, path), handler);
  }

  return {
    get: (path: string, handler: RouteHandler) => add("GET", path, handler),
    post: (path: string, handler: RouteHandler) => add("POST", path, handler),
    put: (path: string, handler: RouteHandler) => add("PUT", path, handler),
    patch: (path: string, handler: RouteHandler) => add("PATCH", path, handler),
    delete: (path: string, handler: RouteHandler) => add("DELETE", path, handler),
    async handle(request: RouteRequest): Promise<RouteResponse> {
      const handler = routes.get(key(request.method, request.path));
      if (!handler) {
        throw new ApiError("NOT_FOUND", "Route not found.", 404, { path: request.path });
      }
      return handler(request);
    }
  };
}
```

- [ ] **Step 3: Create server and app entry**

Create `server/shared/http/server.ts`:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { serializeApiError } from "./errors";
import type { HttpMethod, RouteRequest, RouteResponse } from "./router";

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.method === "GET" || request.method === "DELETE") {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

export function createHttpServer(router: { handle(request: RouteRequest): Promise<RouteResponse> }) {
  return createServer(async (request, response) => {
    const requestId = request.headers["x-request-id"]?.toString() ?? randomUUID();

    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const routeResponse = await router.handle({
        method: request.method as HttpMethod,
        path: url.pathname,
        headers: request.headers,
        requestId,
        body: await readJsonBody(request)
      });

      response.setHeader("X-Request-Id", requestId);
      sendJson(response, routeResponse.status, routeResponse.body);
    } catch (error) {
      response.setHeader("X-Request-Id", requestId);
      const body = serializeApiError(error, requestId);
      const status = error instanceof Error && "status" in error ? Number(error.status) : 500;
      sendJson(response, Number.isFinite(status) ? status : 500, body);
    }
  });
}
```

Create `server/app.ts`:

```ts
import { createRouter } from "./shared/http/router";
import { createHttpServer } from "./shared/http/server";

export function createWiseEffServer() {
  const router = createRouter();

  router.get("/api/v1/health", async () => ({
    status: 200,
    body: { ok: true, service: "wiseeff-api" }
  }));

  return createHttpServer(router);
}
```

Create `server/index.ts`:

```ts
import "dotenv/config";
import { loadServerEnv } from "./config/env";
import { createWiseEffServer } from "./app";

const env = loadServerEnv(process.env);
const server = createWiseEffServer();

server.listen(env.PORT, "127.0.0.1", () => {
  console.log(`WiseEff API listening on http://127.0.0.1:${env.PORT}`);
});
```

- [ ] **Step 4: Add API test client helper**

Create `server/test/testClient.ts`:

```ts
import type { Server } from "node:http";

export async function requestJson(server: Server, path: string, init: RequestInit = {}) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": "test-request",
        ...(init.headers ?? {})
      }
    });
    const body = await response.json();
    return { status: response.status, body, headers: response.headers };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
```

- [ ] **Step 5: Add a server smoke test**

Create `server/app.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createWiseEffServer } from "./app";
import { requestJson } from "./test/testClient";

describe("WiseEff API", () => {
  it("serves the health endpoint", async () => {
    const response = await requestJson(createWiseEffServer(), "/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, service: "wiseeff-api" });
  });
});
```

- [ ] **Step 6: Verify**

Run:

```bash
npm run test:server -- server/shared/http/router.test.ts server/app.test.ts
```

Expected: router and health endpoint tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/shared/http/router.ts server/shared/http/router.test.ts server/shared/http/server.ts server/app.ts server/app.test.ts server/index.ts server/test/testClient.ts
git commit -m "feat: add m0 api server skeleton"
```

### Task 4: Add Database Client And Migration Runner

**Files:**
- Create: `server/shared/database/client.ts`
- Create: `server/shared/database/client.test.ts`
- Create: `server/shared/database/migrations.ts`
- Create: `server/shared/database/migrations.test.ts`
- Create: `server/migrations/0001_m0_foundation.sql`
- Create: `scripts/migrate.ts`
- Create: `scripts/seed-m0.ts`

- [ ] **Step 1: Write database adapter tests**

Create `server/shared/database/client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createDatabase } from "./client";

describe("createDatabase", () => {
  it("delegates queries to the provided query function", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const db = createDatabase({
      query: async (text, values = []) => {
        calls.push({ text, values });
        return { rows: [{ ok: true }], rowCount: 1 };
      }
    });

    const result = await db.query<{ ok: boolean }>("select $1::boolean as ok", [true]);

    expect(result.rows).toEqual([{ ok: true }]);
    expect(calls).toEqual([{ text: "select $1::boolean as ok", values: [true] }]);
  });
});
```

- [ ] **Step 2: Implement database adapter**

Create `server/shared/database/client.ts`:

```ts
import pg from "pg";

export type QueryResult<Row> = {
  rows: Row[];
  rowCount: number | null;
};

export type Queryable = {
  query<Row>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
};

export function createDatabase(queryable: Queryable): Queryable {
  return {
    query: (text, values = []) => queryable.query(text, values)
  };
}

export function createPostgresDatabase(connectionString: string): Queryable {
  const pool = new pg.Pool({ connectionString });
  return createDatabase({
    query: async (text, values = []) => pool.query(text, values)
  });
}
```

- [ ] **Step 3: Write migration tests**

Create `server/shared/database/migrations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getPendingMigrations } from "./migrations";

describe("getPendingMigrations", () => {
  it("returns migrations that have not been applied", () => {
    const pending = getPendingMigrations(["0001_m0_foundation.sql", "0002_next.sql"], ["0001_m0_foundation.sql"]);

    expect(pending).toEqual(["0002_next.sql"]);
  });
});
```

- [ ] **Step 4: Implement migration helpers**

Create `server/shared/database/migrations.ts`:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Queryable } from "./client";

export function getPendingMigrations(allMigrations: string[], appliedMigrations: string[]) {
  const applied = new Set(appliedMigrations);
  return allMigrations.filter((migration) => !applied.has(migration));
}

export async function applyMigrations(db: Queryable, migrationsDir: string) {
  await db.query(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  const applied = await db.query<{ name: string }>("select name from schema_migrations order by name");
  const pending = getPendingMigrations(files, applied.rows.map((row) => row.name));

  for (const file of pending) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await db.query("begin");
    try {
      await db.query(sql);
      await db.query("insert into schema_migrations (name) values ($1)", [file]);
      await db.query("commit");
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  }

  return pending;
}
```

- [ ] **Step 5: Add M0 schema migration**

Create `server/migrations/0001_m0_foundation.sql`:

```sql
create table if not exists organizations (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id text primary key,
  organization_id text not null references organizations(id),
  name text not null,
  email text not null unique,
  title text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  last_active_at timestamptz
);

create table if not exists roles (
  id text primary key,
  name text not null,
  level text not null,
  permissions text[] not null
);

create table if not exists user_role_bindings (
  id text primary key,
  user_id text not null references users(id),
  organization_id text not null references organizations(id),
  project_id text,
  role_id text not null references roles(id),
  created_at timestamptz not null default now()
);

create index if not exists user_role_bindings_user_id_idx on user_role_bindings(user_id);
create index if not exists user_role_bindings_project_id_idx on user_role_bindings(project_id);

create table if not exists audit_events (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text,
  actor_user_id text references users(id),
  actor_type text not null,
  app text not null,
  kind text not null,
  action text not null,
  severity text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  trace_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_project_id_created_at_idx on audit_events(project_id, created_at desc);
create index if not exists audit_events_actor_user_id_idx on audit_events(actor_user_id);
create index if not exists audit_events_kind_idx on audit_events(kind);
```

- [ ] **Step 6: Add migration and seed scripts**

Create `scripts/migrate.ts`:

```ts
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadServerEnv } from "../server/config/env";
import { createPostgresDatabase } from "../server/shared/database/client";
import { applyMigrations } from "../server/shared/database/migrations";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = loadServerEnv(process.env);

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to run migrations.");
}

const db = createPostgresDatabase(env.DATABASE_URL);
const applied = await applyMigrations(db, path.join(root, "server", "migrations"));

console.log(`Applied ${applied.length} migration(s): ${applied.join(", ") || "none"}`);
```

Create `scripts/seed-m0.ts`:

```ts
import "dotenv/config";
import { loadServerEnv } from "../server/config/env";
import { createPostgresDatabase } from "../server/shared/database/client";

const env = loadServerEnv(process.env);

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to seed M0 data.");
}

const db = createPostgresDatabase(env.DATABASE_URL);

await db.query(
  `
  insert into organizations (id, name)
  values ($1, $2)
  on conflict (id) do update set name = excluded.name
  `,
  ["org-chargelab", "ChargeLab"]
);

await db.query(
  `
  insert into users (id, organization_id, name, email, title, is_active)
  values ($1, $2, $3, $4, $5, true)
  on conflict (id) do update set name = excluded.name, email = excluded.email, title = excluded.title
  `,
  ["u-xu-yun", "org-chargelab", "Xu Yun", "xu@chargelab.cn", "Platform Owner"]
);

const roles = [
  ["guest", "Guest", "guest", ["parameter:view"]],
  ["hardware-user", "Hardware User", "user", ["parameter:view", "parameter:edit", "debugging:use", "logs:upload"]],
  ["software-user", "Software User", "user", ["parameter:view", "parameter:edit", "debugging:use", "logs:upload"]],
  ["hardware-committer", "Hardware Committer", "committer", ["parameter:view", "parameter:edit", "debugging:use", "logs:upload", "parameter:review"]],
  ["software-committer", "Software Committer", "committer", ["parameter:view", "parameter:edit", "debugging:use", "logs:upload", "parameter:review"]],
  ["admin", "Admin", "admin", ["parameter:view", "parameter:edit", "debugging:use", "logs:upload", "parameter:review", "admin:access", "users:manage"]]
] as const;

for (const [id, name, level, permissions] of roles) {
  await db.query(
    `
    insert into roles (id, name, level, permissions)
    values ($1, $2, $3, $4)
    on conflict (id) do update set name = excluded.name, level = excluded.level, permissions = excluded.permissions
    `,
    [id, name, level, permissions]
  );
}

await db.query(
  `
  insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
  values ($1, $2, $3, null, $4)
  on conflict (id) do update set role_id = excluded.role_id
  `,
  ["urb-xu-admin", "u-xu-yun", "org-chargelab", "admin"]
);

console.log("Seeded M0 WiseEff data.");
```

- [ ] **Step 7: Verify**

Run:

```bash
npm run test:server -- server/shared/database/client.test.ts server/shared/database/migrations.test.ts
npm run build
```

Expected: backend database tests pass and TypeScript build passes.

- [ ] **Step 8: Commit**

```bash
git add server/shared/database server/migrations scripts/migrate.ts scripts/seed-m0.ts
git commit -m "feat: add m0 database migration baseline"
```

### Task 5: Implement Backend Auth Policy And GET /api/v1/me

**Files:**
- Create: `server/modules/auth/types.ts`
- Create: `server/modules/auth/policy.ts`
- Create: `server/modules/auth/policy.test.ts`
- Create: `server/modules/auth/repository.ts`
- Create: `server/modules/auth/routes.ts`
- Create: `server/modules/auth/routes.test.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Write backend permission tests**

Create `server/modules/auth/policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canPerform, compareRoles } from "./policy";

describe("auth policy", () => {
  it("orders roles by operational authority", () => {
    expect(compareRoles("guest", "hardware-user")).toBeLessThan(0);
    expect(compareRoles("software-user", "hardware-user")).toBe(0);
    expect(compareRoles("hardware-committer", "software-user")).toBeGreaterThan(0);
    expect(compareRoles("admin", "software-committer")).toBeGreaterThan(0);
  });

  it("checks action permissions", () => {
    expect(canPerform("guest", "parameter:edit")).toBe(false);
    expect(canPerform("hardware-user", "parameter:edit")).toBe(true);
    expect(canPerform("software-user", "debugging:use")).toBe(true);
    expect(canPerform("software-user", "parameter:review")).toBe(false);
    expect(canPerform("hardware-committer", "parameter:review")).toBe(true);
    expect(canPerform("admin", "users:manage")).toBe(true);
  });
});
```

- [ ] **Step 2: Implement auth types and policy**

Create `server/modules/auth/types.ts`:

```ts
export type BackendRoleId =
  | "guest"
  | "hardware-user"
  | "software-user"
  | "hardware-committer"
  | "software-committer"
  | "admin";

export type BackendPermission =
  | "parameter:view"
  | "parameter:edit"
  | "debugging:use"
  | "logs:upload"
  | "parameter:review"
  | "admin:access"
  | "users:manage";

export type AuthenticatedUser = {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  title: string;
  isActive: boolean;
};

export type RoleBinding = {
  projectId: string | null;
  roleId: BackendRoleId;
};

export type AuthContext = {
  user: AuthenticatedUser;
  organization: {
    id: string;
    name: string;
  };
  roles: RoleBinding[];
  permissions: BackendPermission[];
};
```

Create `server/modules/auth/policy.ts`:

```ts
import type { BackendPermission, BackendRoleId } from "./types";

const roleRank: Record<BackendRoleId, number> = {
  guest: 0,
  "hardware-user": 1,
  "software-user": 1,
  "hardware-committer": 2,
  "software-committer": 2,
  admin: 3
};

const rolePermissions: Record<BackendRoleId, BackendPermission[]> = {
  guest: ["parameter:view"],
  "hardware-user": ["parameter:view", "parameter:edit", "debugging:use", "logs:upload"],
  "software-user": ["parameter:view", "parameter:edit", "debugging:use", "logs:upload"],
  "hardware-committer": ["parameter:view", "parameter:edit", "debugging:use", "logs:upload", "parameter:review"],
  "software-committer": ["parameter:view", "parameter:edit", "debugging:use", "logs:upload", "parameter:review"],
  admin: ["parameter:view", "parameter:edit", "debugging:use", "logs:upload", "parameter:review", "admin:access", "users:manage"]
};

export function compareRoles(left: BackendRoleId, right: BackendRoleId) {
  return roleRank[left] - roleRank[right];
}

export function permissionsForRoles(roleIds: BackendRoleId[]): BackendPermission[] {
  return Array.from(new Set(roleIds.flatMap((roleId) => rolePermissions[roleId])));
}

export function canPerform(roleId: BackendRoleId, permission: BackendPermission) {
  return rolePermissions[roleId].includes(permission);
}
```

- [ ] **Step 3: Implement auth repository**

Create `server/modules/auth/repository.ts`:

```ts
import { ApiError } from "../../shared/http/errors";
import type { Queryable } from "../../shared/database/client";
import { permissionsForRoles } from "./policy";
import type { AuthContext, BackendRoleId } from "./types";

type AuthRow = {
  user_id: string;
  organization_id: string;
  organization_name: string;
  name: string;
  email: string;
  title: string;
  is_active: boolean;
  project_id: string | null;
  role_id: BackendRoleId;
};

export async function getAuthContext(db: Queryable, userId: string): Promise<AuthContext> {
  const result = await db.query<AuthRow>(
    `
    select
      users.id as user_id,
      users.organization_id,
      organizations.name as organization_name,
      users.name,
      users.email,
      users.title,
      users.is_active,
      user_role_bindings.project_id,
      user_role_bindings.role_id
    from users
    join organizations on organizations.id = users.organization_id
    join user_role_bindings on user_role_bindings.user_id = users.id
    where users.id = $1
    order by user_role_bindings.project_id nulls first
    `,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new ApiError("UNAUTHENTICATED", "User is not authenticated.", 401);
  }

  const first = result.rows[0];
  if (!first.is_active) {
    throw new ApiError("FORBIDDEN", "User is inactive.", 403);
  }

  const roles = result.rows.map((row) => ({ projectId: row.project_id, roleId: row.role_id }));

  return {
    user: {
      id: first.user_id,
      organizationId: first.organization_id,
      name: first.name,
      email: first.email,
      title: first.title,
      isActive: first.is_active
    },
    organization: {
      id: first.organization_id,
      name: first.organization_name
    },
    roles,
    permissions: permissionsForRoles(roles.map((role) => role.roleId))
  };
}
```

- [ ] **Step 4: Write GET /me route tests**

Create `server/modules/auth/routes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";

describe("GET /api/v1/me", () => {
  it("returns the seeded current user in development fallback mode", async () => {
    const response = await requestJson(createWiseEffServer(), "/api/v1/me", {
      headers: { "X-WiseEff-User": "u-xu-yun" }
    });

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe("u-xu-yun");
    expect(response.body.roles[0].roleId).toBe("admin");
    expect(response.body.permissions).toContain("admin:access");
  });
});
```

- [ ] **Step 5: Implement auth routes with an injectable fallback store**

Create `server/modules/auth/routes.ts`:

```ts
import type { Queryable } from "../../shared/database/client";
import type { ReturnTypeOfCreateRouter } from "../../shared/http/router";
import { getAuthContext } from "./repository";
import type { AuthContext } from "./types";

export const developmentAuthContext: AuthContext = {
  user: {
    id: "u-xu-yun",
    organizationId: "org-chargelab",
    name: "Xu Yun",
    email: "xu@chargelab.cn",
    title: "Platform Owner",
    isActive: true
  },
  organization: {
    id: "org-chargelab",
    name: "ChargeLab"
  },
  roles: [{ projectId: null, roleId: "admin" }],
  permissions: ["parameter:view", "parameter:edit", "debugging:use", "logs:upload", "parameter:review", "admin:access", "users:manage"]
};

export function registerAuthRoutes(router: ReturnTypeOfCreateRouter, options: { db?: Queryable }) {
  router.get("/api/v1/me", async (request) => {
    const userId = request.headers["x-wiseeff-user"]?.toString() ?? developmentAuthContext.user.id;
    const context = options.db ? await getAuthContext(options.db, userId) : developmentAuthContext;

    return {
      status: 200,
      body: context
    };
  });
}
```

Patch `server/shared/http/router.ts` to export the router type:

```ts
export type ReturnTypeOfCreateRouter = ReturnType<typeof createRouter>;
```

Patch `server/app.ts`:

```ts
import { registerAuthRoutes } from "./modules/auth/routes";
import type { Queryable } from "./shared/database/client";
import { createRouter } from "./shared/http/router";
import { createHttpServer } from "./shared/http/server";

export function createWiseEffServer(options: { db?: Queryable } = {}) {
  const router = createRouter();

  router.get("/api/v1/health", async () => ({
    status: 200,
    body: { ok: true, service: "wiseeff-api" }
  }));

  registerAuthRoutes(router, { db: options.db });

  return createHttpServer(router);
}
```

- [ ] **Step 6: Verify**

Run:

```bash
npm run test:server -- server/modules/auth/policy.test.ts server/modules/auth/routes.test.ts
npm run build
```

Expected: backend auth tests and build pass.

- [ ] **Step 7: Commit**

```bash
git add server/modules/auth server/shared/http/router.ts server/app.ts
git commit -m "feat: add m0 auth context endpoint"
```

### Task 6: Add Audit Repository And Routes

**Files:**
- Create: `server/modules/audit/types.ts`
- Create: `server/modules/audit/repository.ts`
- Create: `server/modules/audit/repository.test.ts`
- Create: `server/modules/audit/routes.ts`
- Create: `server/modules/audit/routes.test.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Write audit repository tests**

Create `server/modules/audit/repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Queryable } from "../../shared/database/client";
import { createAuditEvent, listAuditEvents } from "./repository";

describe("audit repository", () => {
  it("inserts audit events with metadata", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const db: Queryable = {
      query: async (text, values = []) => {
        calls.push({ text, values });
        return { rows: [{ id: "audit-1" }], rowCount: 1 };
      }
    };

    await createAuditEvent(db, {
      id: "audit-1",
      organizationId: "org-chargelab",
      projectId: "aurora",
      actorUserId: "u-xu-yun",
      actorType: "user",
      app: "parameter-admin",
      kind: "export",
      action: "Exported parameter snapshot",
      severity: "Low",
      targetType: "parameter-snapshot",
      targetId: "snap-1",
      metadata: { snapshotName: "parameter-admin.json" },
      traceId: "trace-1"
    });

    expect(calls[0].text).toContain("insert into audit_events");
    expect(calls[0].values).toContain("audit-1");
  });

  it("lists audit events for an organization", async () => {
    const db: Queryable = {
      query: async () => ({
        rows: [
          {
            id: "audit-1",
            organization_id: "org-chargelab",
            project_id: "aurora",
            actor_user_id: "u-xu-yun",
            actor_type: "user",
            app: "parameter-admin",
            kind: "export",
            action: "Exported parameter snapshot",
            severity: "Low",
            target_type: "parameter-snapshot",
            target_id: "snap-1",
            metadata: { snapshotName: "parameter-admin.json" },
            trace_id: "trace-1",
            created_at: "2026-05-25T00:00:00.000Z"
          }
        ],
        rowCount: 1
      })
    };

    const rows = await listAuditEvents(db, { organizationId: "org-chargelab" });

    expect(rows[0].id).toBe("audit-1");
    expect(rows[0].metadata).toEqual({ snapshotName: "parameter-admin.json" });
  });
});
```

- [ ] **Step 2: Implement audit types and repository**

Create `server/modules/audit/types.ts`:

```ts
export type AuditSeverity = "High" | "Medium" | "Low";

export type CreateAuditEventInput = {
  id: string;
  organizationId: string;
  projectId: string | null;
  actorUserId: string | null;
  actorType: "user" | "agent" | "system";
  app: string;
  kind: string;
  action: string;
  severity: AuditSeverity;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  traceId: string;
};

export type AuditEventDto = CreateAuditEventInput & {
  createdAt: string;
};
```

Create `server/modules/audit/repository.ts`:

```ts
import type { Queryable } from "../../shared/database/client";
import type { AuditEventDto, CreateAuditEventInput } from "./types";

type AuditEventRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  actor_user_id: string | null;
  actor_type: "user" | "agent" | "system";
  app: string;
  kind: string;
  action: string;
  severity: "High" | "Medium" | "Low";
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  trace_id: string;
  created_at: string;
};

function toDto(row: AuditEventRow): AuditEventDto {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    actorUserId: row.actor_user_id,
    actorType: row.actor_type,
    app: row.app,
    kind: row.kind,
    action: row.action,
    severity: row.severity,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: row.metadata,
    traceId: row.trace_id,
    createdAt: row.created_at
  };
}

export async function createAuditEvent(db: Queryable, input: CreateAuditEventInput) {
  await db.query(
    `
    insert into audit_events (
      id, organization_id, project_id, actor_user_id, actor_type, app, kind,
      action, severity, target_type, target_id, metadata, trace_id
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
    `,
    [
      input.id,
      input.organizationId,
      input.projectId,
      input.actorUserId,
      input.actorType,
      input.app,
      input.kind,
      input.action,
      input.severity,
      input.targetType,
      input.targetId,
      JSON.stringify(input.metadata),
      input.traceId
    ]
  );
}

export async function listAuditEvents(db: Queryable, query: { organizationId: string; projectId?: string }) {
  const result = await db.query<AuditEventRow>(
    `
    select *
    from audit_events
    where organization_id = $1
      and ($2::text is null or project_id = $2)
    order by created_at desc
    limit 100
    `,
    [query.organizationId, query.projectId ?? null]
  );

  return result.rows.map(toDto);
}
```

- [ ] **Step 3: Write audit route tests**

Create `server/modules/audit/routes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";

describe("audit routes", () => {
  it("rejects audit creation without a database adapter", async () => {
    const response = await requestJson(createWiseEffServer(), "/api/v1/audit-events", {
      method: "POST",
      body: JSON.stringify({
        app: "parameter-admin",
        kind: "export",
        action: "Exported parameter snapshot",
        severity: "Low",
        metadata: {}
      })
    });

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
  });
});
```

- [ ] **Step 4: Implement audit routes**

Create `server/modules/audit/routes.ts`:

```ts
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuthContext } from "../auth/types";
import { ApiError } from "../../shared/http/errors";
import type { Queryable } from "../../shared/database/client";
import type { ReturnTypeOfCreateRouter } from "../../shared/http/router";
import { createAuditEvent, listAuditEvents } from "./repository";

const auditBodySchema = z.object({
  app: z.string().min(1),
  kind: z.string().min(1),
  action: z.string().min(1),
  severity: z.enum(["High", "Medium", "Low"]),
  projectId: z.string().nullable().optional(),
  targetType: z.string().nullable().optional(),
  targetId: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).default({})
});

export function registerAuditRoutes(
  router: ReturnTypeOfCreateRouter,
  options: { db?: Queryable; getCurrentAuthContext: () => Promise<AuthContext> | AuthContext }
) {
  router.post("/api/v1/audit-events", async (request) => {
    if (!options.db) {
      throw new ApiError("INTERNAL_ERROR", "Database adapter is required for audit writes.", 500);
    }

    const auth = await options.getCurrentAuthContext();
    if (!auth.permissions.includes("admin:access")) {
      throw new ApiError("FORBIDDEN", "Admin access required.", 403);
    }

    const body = auditBodySchema.parse(request.body);
    const id = randomUUID();

    await createAuditEvent(options.db, {
      id,
      organizationId: auth.organization.id,
      projectId: body.projectId ?? null,
      actorUserId: auth.user.id,
      actorType: "user",
      app: body.app,
      kind: body.kind,
      action: body.action,
      severity: body.severity,
      targetType: body.targetType ?? null,
      targetId: body.targetId ?? null,
      metadata: body.metadata,
      traceId: request.requestId
    });

    return { status: 201, body: { id } };
  });

  router.get("/api/v1/audit-events", async () => {
    if (!options.db) {
      throw new ApiError("INTERNAL_ERROR", "Database adapter is required for audit reads.", 500);
    }

    const auth = await options.getCurrentAuthContext();
    if (!auth.permissions.includes("admin:access")) {
      throw new ApiError("FORBIDDEN", "Admin access required.", 403);
    }

    const items = await listAuditEvents(options.db, { organizationId: auth.organization.id });
    return { status: 200, body: { items } };
  });
}
```

Patch `server/app.ts`:

```ts
import { developmentAuthContext, registerAuthRoutes } from "./modules/auth/routes";
import { registerAuditRoutes } from "./modules/audit/routes";
import type { Queryable } from "./shared/database/client";
import { createRouter } from "./shared/http/router";
import { createHttpServer } from "./shared/http/server";

export function createWiseEffServer(options: { db?: Queryable } = {}) {
  const router = createRouter();

  router.get("/api/v1/health", async () => ({
    status: 200,
    body: { ok: true, service: "wiseeff-api" }
  }));

  registerAuthRoutes(router, { db: options.db });
  registerAuditRoutes(router, {
    db: options.db,
    getCurrentAuthContext: () => developmentAuthContext
  });

  return createHttpServer(router);
}
```

- [ ] **Step 5: Verify**

Run:

```bash
npm run test:server -- server/modules/audit/repository.test.ts server/modules/audit/routes.test.ts
npm run build
```

Expected: audit tests and build pass.

- [ ] **Step 6: Commit**

```bash
git add server/modules/audit server/app.ts
git commit -m "feat: add m0 audit persistence boundary"
```

### Task 7: Add Frontend API Runtime Mode And Client

**Files:**
- Create: `src/infrastructure/http/apiClient.ts`
- Create: `src/infrastructure/http/apiClient.test.ts`
- Create: `src/infrastructure/http/runtimeMode.ts`
- Create: `src/infrastructure/http/runtimeMode.test.ts`
- Create: `src/infrastructure/http/authClient.ts`
- Create: `src/infrastructure/http/authClient.test.ts`

- [ ] **Step 1: Write API client tests**

Create `src/infrastructure/http/apiClient.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./apiClient";

describe("createApiClient", () => {
  it("requests JSON from the configured base URL", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = createApiClient({ baseUrl: "http://127.0.0.1:8787", fetchImpl: fetchMock });

    await expect(client.get("/api/v1/health")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/api/v1/health", {
      headers: { Accept: "application/json" },
      method: "GET"
    });
  });

  it("maps API error responses", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "FORBIDDEN",
            message: "Admin access required.",
            details: {},
            requestId: "req-1"
          }
        }),
        { status: 403 }
      )
    );
    const client = createApiClient({ baseUrl: "", fetchImpl: fetchMock });

    await expect(client.get("/api/v1/audit-events")).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Admin access required."
    });
  });
});
```

- [ ] **Step 2: Implement API client**

Create `src/infrastructure/http/apiClient.ts`:

```ts
export class WiseEffApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown>,
    public readonly requestId: string
  ) {
    super(message);
    this.name = "WiseEffApiError";
  }
}

type ApiClientOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

async function parseJson(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export function createApiClient({ baseUrl, fetchImpl = fetch }: ApiClientOptions) {
  async function request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, init);
    const body = await parseJson(response);

    if (!response.ok) {
      const error = body?.error ?? {};
      throw new WiseEffApiError(error.code ?? "INTERNAL_ERROR", error.message ?? "Request failed.", error.details ?? {}, error.requestId ?? "");
    }

    return body as T;
  }

  return {
    get: <T>(path: string) =>
      request<T>(path, {
        method: "GET",
        headers: { Accept: "application/json" }
      }),
    post: <T>(path: string, body: unknown) =>
      request<T>(path, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body)
      })
  };
}
```

- [ ] **Step 3: Write runtime mode tests**

Create `src/infrastructure/http/runtimeMode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseRuntimeMode } from "./runtimeMode";

describe("parseRuntimeMode", () => {
  it("defaults to mock mode", () => {
    expect(parseRuntimeMode(undefined, "development")).toBe("mock");
  });

  it("accepts api mode", () => {
    expect(parseRuntimeMode("api", "development")).toBe("api");
  });

  it("blocks mock mode in production", () => {
    expect(() => parseRuntimeMode("mock", "production")).toThrow("Mock runtime cannot be used in production builds");
  });
});
```

- [ ] **Step 4: Implement runtime mode**

Create `src/infrastructure/http/runtimeMode.ts`:

```ts
export type WiseEffRuntimeMode = "mock" | "api";

export function parseRuntimeMode(value: string | undefined, environment: string): WiseEffRuntimeMode {
  const mode = value === "api" ? "api" : "mock";

  if (environment === "production" && mode === "mock") {
    throw new Error("Mock runtime cannot be used in production builds");
  }

  return mode;
}

export const wiseEffRuntimeMode = parseRuntimeMode(import.meta.env.VITE_WISEEFF_RUNTIME_MODE, import.meta.env.MODE);
export const wiseEffApiBaseUrl = import.meta.env.VITE_WISEEFF_API_BASE_URL ?? "http://127.0.0.1:8787";
```

- [ ] **Step 5: Write auth client tests**

Create `src/infrastructure/http/authClient.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./apiClient";
import { createAuthClient } from "./authClient";

describe("createAuthClient", () => {
  it("fetches the current auth context", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          user: { id: "u-xu-yun", organizationId: "org-chargelab", name: "Xu Yun", email: "xu@chargelab.cn", title: "Platform Owner", isActive: true },
          organization: { id: "org-chargelab", name: "ChargeLab" },
          roles: [{ projectId: null, roleId: "admin" }],
          permissions: ["admin:access"]
        }),
        { status: 200 }
      )
    );

    const authClient = createAuthClient(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));
    const context = await authClient.getCurrentAuthContext();

    expect(context.user.id).toBe("u-xu-yun");
    expect(context.roles[0].roleId).toBe("admin");
  });
});
```

- [ ] **Step 6: Implement auth client**

Create `src/infrastructure/http/authClient.ts`:

```ts
import { createApiClient } from "./apiClient";
import { wiseEffApiBaseUrl } from "./runtimeMode";

export type AuthContextDto = {
  user: {
    id: string;
    organizationId: string;
    name: string;
    email: string;
    title: string;
    isActive: boolean;
  };
  organization: {
    id: string;
    name: string;
  };
  roles: Array<{
    projectId: string | null;
    roleId: string;
  }>;
  permissions: string[];
};

export function createAuthClient(apiClient = createApiClient({ baseUrl: wiseEffApiBaseUrl })) {
  return {
    getCurrentAuthContext: () => apiClient.get<AuthContextDto>("/api/v1/me")
  };
}
```

- [ ] **Step 7: Verify**

Run:

```bash
npm test -- src/infrastructure/http/apiClient.test.ts src/infrastructure/http/runtimeMode.test.ts src/infrastructure/http/authClient.test.ts
npm run build
```

Expected: frontend HTTP tests and build pass.

- [ ] **Step 8: Commit**

```bash
git add src/infrastructure/http/apiClient.ts src/infrastructure/http/apiClient.test.ts src/infrastructure/http/runtimeMode.ts src/infrastructure/http/runtimeMode.test.ts src/infrastructure/http/authClient.ts src/infrastructure/http/authClient.test.ts
git commit -m "feat: add frontend api runtime client"
```

### Task 8: Hydrate Frontend Auth Context In API Mode

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Add failing App test**

Patch `src/App.test.tsx` with this test:

```tsx
it("hydrates the active user and role from the API auth context", async () => {
  vi.stubEnv("VITE_WISEEFF_RUNTIME_MODE", "api");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          user: {
            id: "u-api-admin",
            organizationId: "org-chargelab",
            name: "API Admin",
            email: "api-admin@chargelab.cn",
            title: "API Platform Owner",
            isActive: true
          },
          organization: { id: "org-chargelab", name: "ChargeLab" },
          roles: [{ projectId: null, roleId: "admin" }],
          permissions: ["admin:access"]
        }),
        { status: 200 }
      )
    )
  );

  render(<App />);

  expect(await screen.findByText("API Admin")).toBeInTheDocument();

  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
```

- [ ] **Step 2: Add reducer action type**

Patch `src/App.tsx` `AppAction`:

```ts
  | {
      type: "HYDRATE_AUTH_CONTEXT";
      user: User;
      roleId: string;
    }
```

- [ ] **Step 3: Implement reducer branch**

Patch the reducer near role handling:

```ts
    case "HYDRATE_AUTH_CONTEXT": {
      const existingUsers = state.users.filter((user) => user.id !== action.user.id);
      return {
        ...state,
        users: [action.user, ...existingUsers],
        currentUserId: action.user.id,
        activeRoleId: action.roleId
      };
    }
```

- [ ] **Step 4: Add API mode hydration effect**

Patch `src/App.tsx` imports:

```ts
import { createAuthClient } from "@/infrastructure/http/authClient";
import { wiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
```

Add inside `App` after reducer initialization:

```ts
  useEffect(() => {
    if (wiseEffRuntimeMode !== "api") {
      return;
    }

    let cancelled = false;
    createAuthClient()
      .getCurrentAuthContext()
      .then((context) => {
        if (cancelled) return;
        const primaryRole = context.roles[0]?.roleId ?? "guest";
        dispatch({
          type: "HYDRATE_AUTH_CONTEXT",
          roleId: primaryRole,
          user: {
            id: context.user.id,
            name: context.user.name,
            email: context.user.email,
            title: context.user.title,
            roleId: primaryRole,
            isActive: context.user.isActive,
            createdAt: new Date().toISOString(),
            lastActive: "just now"
          }
        });
      })
      .catch(() => {
        dispatch({ type: "ADD_NOTIFICATION", message: "无法连接 WiseEff API，已保留本地演示数据" });
      });

    return () => {
      cancelled = true;
    };
  }, []);
```

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- src/App.test.tsx
npm run build
```

Expected: `App` test and build pass.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: hydrate frontend auth context from api"
```

### Task 9: Wire CI For M0

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`

- [ ] **Step 1: Update CI workflow**

Patch `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  build-and-test:
    name: Build and test
    runs-on: ubuntu-latest

    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Frontend tests
        run: npm test

      - name: Backend tests
        run: npm run test:server
```

- [ ] **Step 2: Update README commands**

Patch `README.md` under common commands:

```md
```bash
npm run dev:api
```

启动 M0 后端 API，默认监听 `http://127.0.0.1:8787`。

```bash
npm run test:server
```

运行后端 Node 环境测试。

```bash
npm run test:all
```

连续运行前端与后端测试。
```
```

Add runtime mode notes:

```md
## 运行模式

默认前端仍运行在 `mock` 模式，适合演示和组件开发。需要连接 M0 API 时，创建本地环境变量：

```text
VITE_WISEEFF_RUNTIME_MODE=api
VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8787
```

生产构建不允许使用 `mock` 作为业务数据源。
```
```

- [ ] **Step 3: Verify**

Run:

```bash
npm run build
npm test
npm run test:server
```

Expected: build, frontend tests, and backend tests pass.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "docs: document m0 api development workflow"
```

### Task 10: Final M0 Foundation Verification

**Files:**
- Read: `docs/product-specs/mvp-scope.md`
- Read: `docs/exec-plans/active/development-roadmap.md`
- Read: `docs/design-docs/testing-strategy.md`

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run build
npm test
npm run test:server
```

Expected:

- `npm run build` exits with code `0`.
- `npm test` exits with code `0`.
- `npm run test:server` exits with code `0`.

- [ ] **Step 2: Run API smoke check**

Run:

```bash
npm run dev:api
```

In a second terminal:

```bash
curl http://127.0.0.1:8787/api/v1/health
curl http://127.0.0.1:8787/api/v1/me
```

Expected health response:

```json
{"ok":true,"service":"wiseeff-api"}
```

Expected auth response contains:

```json
{
  "user": {
    "id": "u-xu-yun"
  },
  "roles": [
    {
      "roleId": "admin"
    }
  ]
}
```

- [ ] **Step 3: Confirm M0 scope coverage**

Check:

- Backend service skeleton exists in `server/`.
- SQL migration baseline exists in `server/migrations/0001_m0_foundation.sql`.
- Auth context endpoint exists at `/api/v1/me`.
- Audit event route and repository exist.
- Frontend API client and runtime mode exist.
- CI runs frontend build, frontend tests, and backend tests.
- README explains API dev mode and runtime mode.

- [ ] **Step 4: Commit final verification notes if README changed during verification**

If verification discovers missing local setup notes, patch `README.md` and run:

```bash
npm run build
npm test
npm run test:server
git add README.md
git commit -m "docs: clarify m0 verification workflow"
```

Expected: only documentation changes are committed in this step.

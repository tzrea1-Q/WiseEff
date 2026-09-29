import { describe, expect, it } from "vitest";
import type { QueryResult, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { hashLocalSessionToken } from "./localAccountCredentials";
import { resolveOfflineLocalSession } from "./offlineLocalSession";

const token = "we_local_12345678901234567890123456789012";
const now = new Date("2026-09-30T00:00:00.000Z");
const activeSession = {
  id: "session-1",
  user_id: "user-1",
  organization_id: "org-1",
  expires_at: "2026-10-01T00:00:00.000Z",
  revoked_at: null,
};

type AuthRow = {
  user_id: string;
  organization_id: string;
  organization_name: string;
  name: string;
  email: string | null;
  username: string | null;
  title: string;
  is_active: boolean;
  project_id: string | null;
  role_id: string;
};

function adminAuthRow(overrides: Partial<AuthRow> = {}): AuthRow {
  return {
    user_id: "user-1",
    organization_id: "org-1",
    organization_name: "Org One",
    name: "Admin",
    email: null,
    username: "admin",
    title: "admin",
    is_active: true,
    project_id: null,
    role_id: "admin",
    ...overrides,
  };
}

function sourceReaderDb(input: {
  session?: typeof activeSession | null;
  authRows?: AuthRow[];
}) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const db: Queryable = {
    async query<Row>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
      calls.push({ text, values });
      const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
      if (normalized.includes("from public.auth_sessions")) {
        const rows = input.session === null ? [] : [input.session ?? activeSession];
        return { rows: rows as Row[], rowCount: rows.length };
      }
      if (normalized.includes("from users join organizations")) {
        const rows = input.authRows ?? [adminAuthRow()];
        return { rows: rows as Row[], rowCount: rows.length };
      }
      if (normalized.includes("from user_role_bindings join roles")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected offline session query: ${normalized}`);
    },
  };
  return { db, calls };
}

async function expectApiError(promise: Promise<unknown>, code: ApiError["code"]) {
  await expect(promise).rejects.toMatchObject({ code });
}

describe("resolveOfflineLocalSession", () => {
  it("rechecks the persisted session and current Organization Admin without any write", async () => {
    const { db, calls } = sourceReaderDb({});

    const result = await resolveOfflineLocalSession(db, token, () => now);

    expect(result).toMatchObject({
      sessionId: "session-1",
      auth: {
        user: { id: "user-1", organizationId: "org-1", isActive: true },
        organization: { id: "org-1" },
        roles: [{ projectId: null, roleId: "admin" }],
      },
    });
    expect(calls[0]?.values).toEqual([hashLocalSessionToken(token)]);
    expect(calls.every(({ text }) => /^\s*select\b/i.test(text))).toBe(true);
    expect(calls.some(({ text }) => /last_used_at|\bupdate\b/i.test(text))).toBe(false);
  });

  it("rejects a non-local token before querying the database", async () => {
    const { db, calls } = sourceReaderDb({});

    await expectApiError(resolveOfflineLocalSession(db, "Bearer invalid", () => now), "UNAUTHENTICATED");

    expect(calls).toEqual([]);
  });

  it.each([
    ["missing", null],
    ["revoked", { ...activeSession, revoked_at: "2026-09-29T00:00:00.000Z" }],
    ["expired", { ...activeSession, expires_at: "2026-09-29T23:59:59.999Z" }],
    ["invalid expiry", { ...activeSession, expires_at: "not-a-date" }],
  ] as const)("rejects a %s persisted session", async (_name, session) => {
    const { db } = sourceReaderDb({ session });

    await expectApiError(resolveOfflineLocalSession(db, token, () => now), "UNAUTHENTICATED");
  });

  it("rejects inactive users and users without an Organization Admin binding", async () => {
    const inactive = sourceReaderDb({ authRows: [adminAuthRow({ is_active: false })] });
    await expectApiError(resolveOfflineLocalSession(inactive.db, token, () => now), "FORBIDDEN");

    const projectAdmin = sourceReaderDb({ authRows: [adminAuthRow({ project_id: "project-1" })] });
    await expectApiError(resolveOfflineLocalSession(projectAdmin.db, token, () => now), "FORBIDDEN");

    const otherRole = sourceReaderDb({ authRows: [adminAuthRow({ role_id: "software-user" })] });
    await expectApiError(resolveOfflineLocalSession(otherRole.db, token, () => now), "FORBIDDEN");
  });
});

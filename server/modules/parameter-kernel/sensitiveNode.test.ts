import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../auth/types";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createPostgresDatabase, type Queryable } from "../../shared/database/client";
import { withTempDatabase } from "../../testing/tempDatabase";
import { ApiError } from "../../shared/http/errors";
import {
  assertSensitiveNodeWriteAllowed,
  assertTrustedSensitiveNodeWriteAllowed,
  matchSensitiveRules,
  resolveDtsNodeCompatible,
  type SensitiveNodeRule
} from "./sensitiveNode";

vi.mock("../audit/repository", () => ({
  createAuditEvent: vi.fn().mockResolvedValue(undefined)
}));

import { createAuditEvent } from "../audit/repository";

const mockedCreateAuditEvent = vi.mocked(createAuditEvent);
function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Engineer",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: "project-1", roleId: "hardware-user" }],
    permissions: ["parameter:view", "parameter:edit"],
    ...overrides
  };
}

function rule(overrides: Partial<SensitiveNodeRule> = {}): SensitiveNodeRule {
  return {
    id: "rule-1",
    organizationId: "org-1",
    projectId: null,
    matchType: "path",
    pattern: "safety/*",
    riskTier: "critical",
    requiredCapability: "parameter:edit-critical",
    enabled: true,
    ...overrides
  };
}

describe("matchSensitiveRules", () => {
  it("matches path patterns and returns riskTier + requiredCapability", () => {
    const matched = matchSensitiveRules(
      [rule({ pattern: "soc/safety@*", riskTier: "critical" })],
      { nodePath: "soc/safety@100/status", projectId: "project-1" }
    );

    expect(matched).toMatchObject({
      riskTier: "critical",
      requiredCapability: "parameter:edit-critical",
      matchType: "path"
    });
  });

  it("matches compatible patterns", () => {
    const matched = matchSensitiveRules(
      [rule({ id: "rule-compat", matchType: "compatible", pattern: "vendor,watchdog*", riskTier: "high" })],
      { nodePath: "amba/wdt@0", compatible: "vendor,watchdog-v2", projectId: "project-1" }
    );

    expect(matched).toMatchObject({
      riskTier: "high",
      matchType: "compatible"
    });
  });

  it("picks the highest riskTier when multiple rules match", () => {
    const matched = matchSensitiveRules(
      [
        rule({ id: "high", pattern: "soc/*", riskTier: "high" }),
        rule({ id: "critical", pattern: "soc/safety@*", riskTier: "critical" })
      ],
      { nodePath: "soc/safety@100/reg", projectId: "project-1" }
    );

    expect(matched?.riskTier).toBe("critical");
    expect(matched?.id).toBe("critical");
  });

  it("applies project-scoped rules and org-wide (null project) rules", () => {
    const matched = matchSensitiveRules(
      [
        rule({ id: "other-project", projectId: "project-2", pattern: "soc/*", riskTier: "critical" }),
        rule({ id: "org-wide", projectId: null, pattern: "soc/*", riskTier: "high" })
      ],
      { nodePath: "soc/cpu@0", projectId: "project-1" }
    );

    expect(matched?.id).toBe("org-wide");
  });

  it("returns null when no rules match", () => {
    expect(
      matchSensitiveRules([rule({ pattern: "other/*" })], {
        nodePath: "soc/cpu@0",
        projectId: "project-1"
      })
    ).toBeNull();
  });
});

describe("assertSensitiveNodeWriteAllowed", () => {
  function fakeDb(rules: SensitiveNodeRule[]): Queryable {
    return {
      query: vi.fn(async () => ({
        rows: rules.map((item) => ({
          id: item.id,
          organization_id: item.organizationId,
          project_id: item.projectId,
          match_type: item.matchType,
          pattern: item.pattern,
          risk_tier: item.riskTier,
          required_capability: item.requiredCapability,
          enabled: item.enabled
        })),
        rowCount: rules.length
      }))
    };
  }

  it("allows writes when no sensitive rules match", async () => {
    await expect(
      assertSensitiveNodeWriteAllowed(fakeDb([]), auth(), {
        organizationId: "org-1",
        projectId: "project-1",
        nodePath: "soc/cpu@0/clock-frequency",
        actorType: "user"
      })
    ).resolves.toBeUndefined();
    expect(mockedCreateAuditEvent).not.toHaveBeenCalled();
  });

  it("denies users without parameter:edit-critical on critical nodes with 403", async () => {
    await expect(
      assertSensitiveNodeWriteAllowed(fakeDb([rule()]), auth(), {
        organizationId: "org-1",
        projectId: "project-1",
        nodePath: "safety/cutover/status",
        actorType: "user"
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403
    } satisfies Partial<ApiError>);
  });

  it("allows users with parameter:edit-critical on critical nodes", async () => {
    await expect(
      assertSensitiveNodeWriteAllowed(
        fakeDb([rule()]),
        auth({ permissions: ["parameter:view", "parameter:edit", "parameter:edit-critical"] }),
        {
          organizationId: "org-1",
          projectId: "project-1",
          nodePath: "safety/cutover/status",
          actorType: "user"
        }
      )
    ).resolves.toBeUndefined();
  });

  it("always denies agent writes on critical nodes, requires human, and audits", async () => {
    mockedCreateAuditEvent.mockClear();

    await expect(
      assertSensitiveNodeWriteAllowed(
        fakeDb([rule()]),
        auth({ permissions: ["parameter:view", "parameter:edit", "parameter:edit-critical"] }),
        {
          organizationId: "org-1",
          projectId: "project-1",
          nodePath: "safety/cutover/status",
          actorType: "agent"
        }
      )
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403
    });

    expect(mockedCreateAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorType: "agent",
        kind: "parameter-sensitive-node-denied",
        action: "deny",
        severity: "High",
        metadata: expect.objectContaining({
          riskTier: "critical",
          requireHuman: true,
          nodePath: "safety/cutover/status"
        })
      })
    );
  });

  it("writes the deny audit on the refusalDb pool handle, not the caller's transaction", async () => {
    mockedCreateAuditEvent.mockClear();
    const tx = fakeDb([rule()]);
    const refusalQueries: string[] = [];
    const refusalDb = {
      query: vi.fn(async (text: string) => {
        refusalQueries.push(text);
        return { rows: [], rowCount: 1 };
      }),
      transaction: vi.fn()
    } as never;

    await expect(
      assertSensitiveNodeWriteAllowed(
        tx,
        auth({ permissions: ["parameter:view", "parameter:edit", "parameter:edit-critical"] }),
        {
          organizationId: "org-1",
          projectId: "project-1",
          nodePath: "safety/cutover/status",
          actorType: "agent",
          requestId: "req-refusal"
        },
        { refusalDb }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    // The audit went through writeRefusalAudit with the pool handle: the repository
    // mock received refusalDb (first arg), never the caller's tx.
    expect(mockedCreateAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockedCreateAuditEvent.mock.calls[0][0]).toBe(refusalDb);
    expect(mockedCreateAuditEvent.mock.calls[0][1]).toMatchObject({
      kind: "parameter-sensitive-node-denied",
      action: "deny",
      traceId: "req-refusal"
    });
  });

  it("resolves compatible from dts_nodes and blocks writes matching compatible rules", async () => {
    const db: Queryable = {
      query: vi.fn(async (text: string) => {
        if (text.includes("from dts_sensitive_node_rules")) {
          return {
            rows: [
              {
                id: "rule-compat",
                organization_id: "org-1",
                project_id: null,
                match_type: "compatible",
                pattern: "vendor,watchdog*",
                risk_tier: "high",
                required_capability: "parameter:edit-critical",
                enabled: true
              }
            ],
            rowCount: 1
          };
        }
        if (text.includes("dts_nodes")) {
          return {
            rows: [{ compatible: "vendor,watchdog-v2" }],
            rowCount: 1
          };
        }
        return { rows: [], rowCount: 0 };
      })
    };

    await expect(
      assertSensitiveNodeWriteAllowed(db, auth({ permissions: ["parameter:view", "parameter:edit"] }), {
        organizationId: "org-1",
        projectId: "project-1",
        nodePath: "amba/wdt@0/status",
        sourceFileName: "board.dts",
        actorType: "user"
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
      details: expect.objectContaining({
        requiredCapability: "parameter:edit-critical",
        riskTier: "high"
      })
    });

    expect(db.query).toHaveBeenCalledWith(
      expect.stringMatching(/dts_nodes/),
      expect.arrayContaining(["project-1", "board.dts"])
    );
  });
});

describe("assertTrustedSensitiveNodeWriteAllowed", () => {
  it("resolves compatible only from the exact server-owned file version when provided", async () => {
    const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
      expect(text).toContain("v.id = $4");
      expect(text).not.toContain("f.current_version_id");
      expect(text).toContain("f.organization_id = $1");
      expect(values).toEqual([
        "org-1",
        "project-1",
        "board.dts",
        "version-locked",
        "/amba/wdt@0",
        "/amba/wdt@0/status"
      ]);
      return { rows: [{ compatible: "vendor,locked-critical" }], rowCount: 1 };
    });

    await expect(resolveDtsNodeCompatible({ query }, {
      organizationId: "org-1",
      projectId: "project-1",
      sourceFileName: "board.dts",
      sourceFileVersionId: "version-locked",
      sourceNodePath: "/amba/wdt@0/status"
    })).resolves.toBe("vendor,locked-critical");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the exact file version has no matching file and node identity", async () => {
    const db: Queryable = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 }))
    };
    await expect(resolveDtsNodeCompatible(db, {
      organizationId: "org-1",
      projectId: "project-1",
      sourceFileName: "board.dts",
      sourceFileVersionId: "version-substituted",
      sourceNodePath: "/amba/wdt@0/status"
    })).rejects.toMatchObject({
      code: "CONFLICT",
      details: expect.objectContaining({ code: "parameter-sensitive-source-version-mismatch" })
    });
  });

  it("allows a capable direct User invocation through the shared trusted write guard", async () => {
    await withTempDatabase({ prefix: "senswriteunit" }, async ({ connectionString }) => {
      const trustedRefusalRoot = createPostgresDatabase(connectionString);
      let primaryError: unknown;
      try {
        const trustedRefusalSink = createTrustedRefusalAuditSink(trustedRefusalRoot);
        const principal = auth({
          permissions: ["parameter:view", "parameter:edit", "parameter:edit-critical"]
        });
        const db: Queryable = {
          query: vi.fn(async () => ({
            rows: [
              {
                id: "rule-1",
                organization_id: "org-1",
                project_id: null,
                match_type: "path",
                pattern: "safety/*",
                risk_tier: "critical",
                required_capability: "parameter:edit-critical",
                enabled: true
              }
            ],
            rowCount: 1
          }))
        };

        await expect(
          assertTrustedSensitiveNodeWriteAllowed(db, principal, {
            organizationId: "org-1",
            projectId: "project-1",
            nodePath: "safety/cutover/status",
            invocation: createUserInvocation(principal),
            requestId: "request-trusted-write-user",
            refusalSink: trustedRefusalSink
          })
        ).resolves.toBeUndefined();
      } catch (error) {
        primaryError = error;
        throw error;
      } finally {
        try {
          await trustedRefusalRoot.close();
        } catch (cleanupError) {
          if (primaryError === undefined) throw cleanupError;
        }
      }
    });
  });
});

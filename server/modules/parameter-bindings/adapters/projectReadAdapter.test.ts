import type pg from "pg";
import { describe, expect, it, vi } from "vitest";

import { makeTestAuthContext } from "../../../testing/authContext";
import { createAgentInvocation, createSystemInvocation, createUserInvocation } from "../../auth/trustedInvocation";
import { BACKEND_ROLE_IDS, type RoleBinding } from "../../auth/types";
import { readProjectProtectedParameters } from "./projectReadAdapter";

const projectId = "project-read-scope";
const organizationId = "org-read-scope";
const makeAuth = (overrides: Parameters<typeof makeTestAuthContext>[0] = {}) =>
  makeTestAuthContext({ organizationId, roleId: "hardware-user", ...overrides });

function makePool(projectExists = true) {
  const query = vi.fn()
    .mockResolvedValueOnce({ rowCount: projectExists ? 1 : 0, rows: [] })
    .mockResolvedValueOnce({ rowCount: 0, rows: [] });
  return { pool: { query } as unknown as pg.Pool, query };
}

describe("project parameter read scope", () => {
  it.each(BACKEND_ROLE_IDS)("honors an organization-wide %s grant", async (roleId) => {
    const { pool, query } = makePool();
    await expect(readProjectProtectedParameters(pool, {
      invocation: createUserInvocation(makeAuth({ roleId })), projectId
    })).resolves.toEqual([]);
    expect(query.mock.calls[0]?.[1]).toEqual([projectId, organizationId]);
    expect(query.mock.calls[1]?.[1]).toEqual([organizationId, projectId]);
  });

  it("honors an explicit grant for the requested project", async () => {
    const { pool } = makePool();
    await expect(readProjectProtectedParameters(pool, {
      invocation: createUserInvocation(makeAuth({ roles: [{ roleId: "hardware-user", projectId }] })), projectId
    })).resolves.toEqual([]);
  });

  it.each([
    { label: "another project", auth: makeAuth({ roles: [{ roleId: "hardware-user", projectId: "other-project" }] }), projectId },
    { label: "no role binding", auth: makeAuth({ roles: [], permissions: ["parameter:view"] }), projectId },
    { label: "missing permission", auth: makeAuth({ permissions: [] }), projectId },
    { label: "inactive account", auth: makeAuth({ isActive: false }), projectId },
    { label: "missing project", auth: makeAuth(), projectId: undefined }
  ])("rejects $label before reading data", async (input) => {
    const { pool, query } = makePool();
    await expect(readProjectProtectedParameters(pool, {
      invocation: createUserInvocation(input.auth), projectId: input.projectId
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(query).not.toHaveBeenCalled();
  });

  it.each(["hardware-user", "admin", "platform-admin"] as const)("keeps %s reads inside the caller organization", async (roleId) => {
    const { pool, query } = makePool(false);
    await expect(readProjectProtectedParameters(pool, {
      invocation: createUserInvocation(makeAuth({ roleId })), projectId
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual([projectId, organizationId]);
  });

  it("honors the accountable Agent principal's organization grant", async () => {
    const { pool } = makePool();
    await expect(readProjectProtectedParameters(pool, {
      invocation: createAgentInvocation(makeAuth(), {
        sessionId: "read-session", toolCallId: "read-call", approval: { required: false }
      }), projectId
    })).resolves.toEqual([]);
  });

  it("keeps an Agent with a project grant out of another project", async () => {
    const { pool, query } = makePool();
    await expect(readProjectProtectedParameters(pool, {
      invocation: createAgentInvocation(makeAuth({ roles: [{ roleId: "hardware-user", projectId: "other-project" }] }), {
        sessionId: "read-session", toolCallId: "read-call", approval: { required: false }
      }), projectId
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(query).not.toHaveBeenCalled();
  });

  it("still requires a trusted, accountable invocation", async () => {
    const { pool, query } = makePool();
    await expect(readProjectProtectedParameters(pool, {
      invocation: createSystemInvocation({ kind: "job", name: "scope-test" }), projectId
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(readProjectProtectedParameters(pool, {
      invocation: { ...createUserInvocation(makeAuth()) }, projectId
    })).rejects.toMatchObject({ code: "INVALID_TRUSTED_INVOCATION_CONTEXT" });
    expect(query).not.toHaveBeenCalled();
  });

  it.each([undefined, "", " "])("does not interpret malformed project binding %j as an organization grant", (projectId) => {
    expect(() => createUserInvocation(makeAuth({
      roles: [{ roleId: "hardware-user", projectId } as RoleBinding]
    }))).toThrow(expect.objectContaining({ code: "INVALID_TRUSTED_INVOCATION_CONTEXT" }));
  });
});

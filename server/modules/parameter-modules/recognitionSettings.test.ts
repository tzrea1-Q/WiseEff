import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "../../shared/database/client";
import { loadModuleRecognitionSettings, loadOrganizationRecognitionRules, updateRegistrationRecognitionSettings } from "./recognitionSettings";
import { makeTestAuthContext } from "../../testing/authContext";
import { createUserInvocation } from "../auth/trustedInvocation";

describe("recognition rules on historical schemas", () => {
  it("reports a deferred organization owner name collision as a conflict", async () => {
    const transaction = vi.fn().mockRejectedValue(Object.assign(new Error("collision"), {
      code: "23505", constraint: "organization_subject_owner_selector_unique",
    }));
    await expect(updateRegistrationRecognitionSettings({ query: vi.fn(), transaction }, {
      organizationId: "org", registrationId: "child", body: { nodeTypeName: "same_child" },
      invocation: createUserInvocation(makeTestAuthContext({ organizationId: "org", userId: "admin" })),
      requestId: "recognition", ifMatch: '"version"', idempotencyKey: "recognition", catalogReleaseId: "release",
    })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("子节点名称或别名") });
  });
  it("returns no overrides on schemas before registration recognition rules", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ available: false }] });
    await expect(loadOrganizationRecognitionRules({ query } satisfies Queryable, "org-historical")).resolves.toEqual([]);
    expect(query).toHaveBeenCalledExactlyOnceWith(
      "select to_regclass('public.registration_recognition_rules') is not null as available",
    );
  });

  it("reads only registration-scoped rules for the organization overlay", async () => {
    const rule = { module_id: "business", canonical_subject_id: "subject", compatibles: ["vendor,new"],
      driver_nature: "physical-device", instance_cardinality: "multiple", node_type_name: null };
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ available: true }] }).mockResolvedValueOnce({ rows: [rule] });
    await expect(loadOrganizationRecognitionRules({ query } satisfies Queryable, "org-current")).resolves.toEqual([rule]);
    expect(query.mock.calls[1]?.[0]).toContain("public.registration_recognition_rules");
    expect(query.mock.calls.every(([sql]) => !sql.includes("public.module_recognition_rules"))).toBe(true);
  });

  it.each(["42501", "42P01"])("propagates SQLSTATE %s from an existing feature table", async code => {
    const error = Object.assign(new Error("native query refusal"), { code });
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ available: true }] }).mockRejectedValueOnce(error);
    await expect(loadOrganizationRecognitionRules({ query } satisfies Queryable, "org-current")).rejects.toBe(error);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[1]).toEqual(["org-current"]);
  });

  it("retains legacy singleton defaults before migration 0212 without referencing the missing rules table", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ available: false }] })
      .mockResolvedValueOnce({ rows: [{ id: "legacy-module", kind: "driver-group", source_key: "compatible:legacy,device",
        legacy_compatibles: ["legacy,device"], legacy_node_type: null,
        legacy_nature: "physical-device", legacy_cardinality: "singleton-per-project" }] })
      .mockResolvedValueOnce({ rows: [] });
    const settings = await loadModuleRecognitionSettings({ query } satisfies Queryable, "org-historical");
    expect(settings.get("legacy-module")).toMatchObject({ recognitionSubjectId: null, compatibles: ["legacy,device"],
      instanceCardinality: "singleton-per-project", overridden: false });
    expect(query.mock.calls.every(([sql]) => !sql.includes("public.module_recognition_rules"))).toBe(true);
  });
});

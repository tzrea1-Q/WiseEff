import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "../../shared/database/client";
import { loadModuleRecognitionSettings, loadOrganizationRecognitionRules } from "./recognitionSettings";

describe("recognition rules on historical schemas", () => {
  it("returns no overrides without issuing a failing table read when migration 0212 is absent", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ available: false }] });
    await expect(loadOrganizationRecognitionRules({ query } satisfies Queryable, "org-historical")).resolves.toEqual([]);
    expect(query).toHaveBeenCalledExactlyOnceWith(
      "select to_regclass('public.module_recognition_rules') is not null as available",
    );
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
    expect(query.mock.calls[1]?.[0]).not.toContain("module_recognition_rules");
  });
});

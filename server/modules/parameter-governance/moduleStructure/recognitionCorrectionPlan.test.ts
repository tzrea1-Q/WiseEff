import type pg from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import type { moduleStructureExportSchema } from "../../contracts/dtoSchemas/moduleStructure";
import { planRecognition } from "./recognition";
import { readRegistrationRecognitionSettings, validateRegistrationRecognitionSettings } from "../../parameter-modules/recognitionSettings";

vi.mock("../../parameter-modules/recognitionSettings", () => ({
  readRegistrationRecognitionSettings: vi.fn(), validateRegistrationRecognitionSettings: vi.fn(),
  registrationRecognitionEtag: () => "test-etag",
}));
vi.mock("../../parameter-modules/recognitionInstances", () => ({ listModuleRecognitionInstances: async () => [] }));

type Subject = z.infer<typeof moduleStructureExportSchema>["subjects"][number];
const nodeRule = { compatibles: [], nodeTypeName: "charger", driverNature: null, instanceCardinality: null };
const driverRule = { compatibles: ["old,driver"], nodeTypeName: null, driverNature: "logical-service" as const, instanceCardinality: "multiple" as const };
const subject = (kind: "driver" | "node-type", mode: "override" | "inherit"): Subject => ({
  subjectId: "node", kind, ownerSubjectId: null, state: "active", cascadeRetired: false,
  placement: { kind: "unset" }, displayAlias: null,
  recognition: { mode, override: mode === "inherit" ? null : { ...(kind === "driver" ? driverRule : nodeRule) },
    effective: { ...(kind === "driver" ? driverRule : nodeRule) } },
});

describe("recognition correction conflict choices", () => {
  beforeEach(() => {
    vi.mocked(readRegistrationRecognitionSettings).mockResolvedValue({ kind: "node-type", recognitionSubjectId: "node", ...nodeRule, overridden: false });
    vi.mocked(validateRegistrationRecognitionSettings).mockImplementation(async (_db, _org, current, body) => ({
      ...current, ...driverRule, ...body, kind: "driver", overridden: true,
    }));
  });

  it.each(["node-type", "driver"] as const)("applies the chosen driver file after a concurrent reset from %s", async originalKind => {
    const baseline = subject(originalKind, "override"), current = subject("node-type", "inherit");
    const edited = structuredClone(baseline);
    edited.recognition!.override!.compatibles = ["fdw,fm1230_swi"];
    const client = { query: vi.fn(async (sql: string) => ({ rows: sql.startsWith("select id") ? [{ id: "registration" }] : [] })) } as unknown as pg.PoolClient;
    const unresolved = await planRecognition(client, "org", "release", [edited], [baseline], [current], {});
    expect(unresolved.conflicts).toEqual([expect.objectContaining({ key: "node:recognition.kind" })]);
    expect(unresolved.changes).toEqual([]);
    const kept = await planRecognition(client, "org", "release", [edited], [baseline], [current], { "node:recognition.kind": "current" });
    expect(kept.changes).toEqual([]); expect(kept.conflicts).toEqual([]);
    const applied = await planRecognition(client, "org", "release", [edited], [baseline], [current], { "node:recognition.kind": "file" });
    expect(applied.conflicts).toEqual([]);
    expect(applied.changes).toEqual([expect.objectContaining({ mode: "override", body: expect.objectContaining({ kind: "driver", compatibles: ["fdw,fm1230_swi"] }) })]);
    expect(applied.kindChanges).toEqual([{ moduleId: "subject:node", field: "kind", before: "node-type", after: "driver" }]);
    if (originalKind === "driver") expect(applied.changes[0].body.driverNature).toBe("logical-service");
  });
});

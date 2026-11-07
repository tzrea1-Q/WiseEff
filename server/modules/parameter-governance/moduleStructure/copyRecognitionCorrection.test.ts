import { beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import type { z } from "zod";
import type { moduleStructureExportSchema, moduleStructurePreviewRequestSchema } from "../../contracts/dtoSchemas/moduleStructure";
import { applyCopySubjects, planCopySubjects } from "./copySubjects";

const mocks = vi.hoisted(() => ({ inherited: vi.fn(), current: vi.fn(), validate: vi.fn(), capacity: vi.fn(),
  instances: vi.fn(), children: vi.fn(), registration: vi.fn(), placement: vi.fn() }));
vi.mock("./preview", () => ({ stable: JSON.stringify }));
vi.mock("../../parameter-modules/recognitionSettings", () => ({
  readInheritedRegistrationRecognitionSettings: mocks.inherited, readRegistrationRecognitionSettings: mocks.current,
  validateRegistrationRecognitionSettings: mocks.validate, validateRecognitionCapacity: mocks.capacity,
  registrationRecognitionEtag: () => "recognition-version",
}));
vi.mock("../../parameter-modules/recognitionInstances", () => ({ listModuleRecognitionInstances: mocks.instances }));
vi.mock("../../catalog-kernel/ownerSchema", () => ({ listOrganizationOwnedSubjects: mocks.children, readCatalogSubjectOwner: vi.fn() }));
vi.mock("../registration/repositories", () => ({ insertRegistration: mocks.registration, insertPlacement: mocks.placement }));

type Subject = z.infer<typeof moduleStructureExportSchema>["subjects"][number];
type Input = z.infer<typeof moduleStructurePreviewRequestSchema>;
const nodeValues = { compatibles: [], nodeTypeName: "fm1230_swi", driverNature: null, instanceCardinality: null };
const driverValues = { compatibles: ["fdw,fm1230_swi"], nodeTypeName: null,
  driverNature: "physical-device" as const, instanceCardinality: "multiple" as const };
const driver: Subject = { subjectId: "fm-subject", kind: "driver", ownerSubjectId: null, state: "active", cascadeRetired: false,
  placement: { kind: "module", moduleRef: "module" }, displayAlias: "fm1230_swi",
  recognition: { mode: "override", override: driverValues, effective: driverValues } };
const node: Subject = { ...driver, kind: "node-type", recognition: { mode: "inherit", override: null, effective: nodeValues } };
const nodeSettings = { kind: "node-type" as const, recognitionSubjectId: driver.subjectId, overridden: false, ...nodeValues };
const input = (subject = driver, resolutions: Input["resolutions"] = {}): Input => ({ mode: "copy", mappings: {}, resolutions,
  document: { format: "wiseeff-module-structure", version: 1,
    source: { exportId: "export", organizationId: "source-org", catalogReleaseId: "release" },
    limits: { maxBytes: 1000, maxEntries: 100 }, counts: { modules: 0, subjects: 1 }, modules: [], subjects: [subject], references: [] } });

function client(owner: string | null = null) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("select s.kind,s.owner_subject_id,rs.lifecycle")) return { rows: [{ kind: "node-type", owner_subject_id: owner, lifecycle: "active" }], rowCount: 1 };
    if (sql.includes("r.status || ':'")) return { rows: [{ id: "registration", subject_id: driver.subjectId, version: "v1", owner_subject_id: null }], rowCount: 1 };
    if (sql.startsWith("select id from parameter_catalog.organization_subject_registrations")) return { rows: [{ id: "registration" }], rowCount: 1 };
    if (sql.includes("current_project_parameter_bindings") || sql.includes("array_agg(distinct b.definition_id")) return { rows: [], rowCount: 0 };
    throw new Error(`Unexpected query: ${sql}`);
  });
  return { db: { query } as unknown as pg.PoolClient, query };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inherited.mockImplementation(async (_db, current) => ({ ...current, ...nodeValues, kind: "node-type", overridden: false }));
  mocks.current.mockResolvedValue(nodeSettings);
  mocks.validate.mockImplementation(async (_db, _org, current, body) => ({ ...current, ...driverValues, kind: body.kind ?? current.kind, overridden: true }));
  mocks.instances.mockResolvedValue([]);
  mocks.children.mockResolvedValue([]);
});

describe("copying organization recognition type corrections", () => {
  it("previews an exported corrected driver using canonical node defaults without creating a registration", async () => {
    const { db, query } = client();
    const plan = await planCopySubjects(db, "target-org", input(), [], new Map([["module", "module"]]), "release");
    expect(mocks.inherited).toHaveBeenCalledWith(db, expect.objectContaining({ kind: "node-type", recognitionSubjectId: driver.subjectId }), "release");
    expect(mocks.validate).toHaveBeenCalledWith(db, "target-org", expect.objectContaining({ kind: "node-type" }),
      { kind: "driver", compatibles: ["fdw,fm1230_swi"], driverNature: "physical-device", instanceCardinality: "multiple" });
    expect(plan.creates).toEqual([driver]);
    expect(plan.changes).toContainEqual({ moduleId: "subject:fm-subject", field: "kind", before: "node-type", after: "driver" });
    expect(mocks.registration).not.toHaveBeenCalled();
    expect(mocks.children).not.toHaveBeenCalled();
    expect(query.mock.calls.every(([sql]) => !/^(insert|update|delete)/i.test(sql))).toBe(true);
  });

  it("keeps the current recognition type until the target conflict is explicitly resolved to the file", async () => {
    const { db } = client();
    const pending = await planCopySubjects(db, "target-org", input(), [node], new Map([["module", "module"]]), "release");
    expect(pending.conflicts).toMatchObject([{ key: "subject:fm-subject:recognition" }]);
    expect(pending.recognitionChanges).toEqual([]);
    const retained = await planCopySubjects(db, "target-org", input(driver, { "subject:fm-subject:recognition": "current" }), [node], new Map([["module", "module"]]), "release");
    expect(retained.recognitionChanges).toEqual([]);
    expect(retained.changes).toEqual([]);
    expect(mocks.validate).not.toHaveBeenCalled();
    const accepted = await planCopySubjects(db, "target-org", input(driver, { "subject:fm-subject:recognition": "file" }), [node], new Map([["module", "module"]]), "release");
    expect(accepted.recognitionChanges).toMatchObject([{ registrationId: "registration", body: { kind: "driver" }, after: { kind: "driver" } }]);
    expect(accepted.changes).toContainEqual({ moduleId: "subject:fm-subject", field: "kind", before: "node-type", after: "driver" });
  });

  it("does not accept an owned Catalog node or a driver label without an explicit compatible override", async () => {
    const owned = client("owner");
    await expect(planCopySubjects(owned.db, "target-org", input(), [], new Map([["module", "module"]]), "release"))
      .rejects.toMatchObject({ code: "CONFLICT" });
    const { db } = client();
    const inheritedDriver = { ...driver, recognition: { mode: "inherit" as const, override: null, effective: driverValues } };
    await expect(planCopySubjects(db, "target-org", input(inheritedDriver), [], new Map([["module", "module"]]), "release"))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.registration).not.toHaveBeenCalled();
    expect(mocks.validate).not.toHaveBeenCalled();
  });

  it("previews returning to the Catalog node type when the inherited source rule wins", async () => {
    const { db } = client();
    mocks.current.mockResolvedValue({ ...nodeSettings, ...driverValues, kind: "driver", overridden: true });
    const plan = await planCopySubjects(db, "target-org", input(node, { "subject:fm-subject:recognition": "file" }), [driver], new Map([["module", "module"]]), "release");
    expect(plan.recognitionChanges).toMatchObject([{ mode: "inherit", after: { kind: "node-type", nodeTypeName: "fm1230_swi" } }]);
    expect(plan.changes).toContainEqual({ moduleId: "subject:fm-subject", field: "kind", before: "driver", after: "node-type" });
    expect(mocks.validate).not.toHaveBeenCalled();
    expect(mocks.capacity).toHaveBeenCalledWith(db, "target-org", expect.objectContaining({ kind: "node-type" }));
  });

  it("does not reapply a correction whose complete target recognition already matches", async () => {
    const { db } = client();
    const plan = await planCopySubjects(db, "target-org", input(), [driver], new Map([["module", "module"]]), "release");
    expect(plan.changes).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.recognitionChanges).toEqual([]);
    expect(mocks.current).not.toHaveBeenCalled();
    expect(mocks.validate).not.toHaveBeenCalled();
  });

  it("retains the original subject identity while scheduling the new registration's driver rule", async () => {
    const { db } = client();
    const changes = await applyCopySubjects(db, "target-org", [driver], new Map([["module", "module"]]), "Copy corrected recognition");
    expect(mocks.registration).toHaveBeenCalledWith(db, expect.objectContaining({ organizationId: "target-org", subjectId: "fm-subject" }));
    expect(changes).toMatchObject([{ subjectId: "fm-subject", mode: "override", body: { kind: "driver", compatibles: ["fdw,fm1230_swi"] } }]);
    expect(mocks.placement).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from "vitest";

import { matchLogicalNode, type LogicalNodeCandidate, type LogicalNodeSnapshot } from "../dts/identity";
import type { Queryable } from "../../shared/database/client";
import {
  bindingKey,
  createOrReuseBinding,
  persistAmbiguousIdentityMapping,
  resolveLogicalContinuity,
  upsertBindingRevisionValues,
  type ProjectPropertyBindingKey,
  type BindingRevisionValues,
} from "./bindingService";

const parentI2cId = "logical-i2c-fdf5e000";
const sc8562Id = "logical-sc8562-6e";
const driverSchemaVersionId = "dsv-sc8562-v1";

function previousSc8562(overrides: Partial<LogicalNodeSnapshot> = {}): LogicalNodeSnapshot {
  return {
    logicalNodeId: sc8562Id,
    nodeLocator: "/amba/i2c@FDF5E000/sc8562@6E",
    name: "sc8562",
    unitAddress: "6E",
    parentLogicalNodeId: parentI2cId,
    driverSchemaVersionId,
    reg: "<0x6e>",
    uniqueKeys: { "i2c-reg": "0x6e" },
    topologyRelation: "child-of:logical-i2c-fdf5e000",
    labels: ["sc8562_chg"],
    ...overrides,
  };
}

function candidate(
  overrides: Partial<LogicalNodeCandidate> & Pick<LogicalNodeCandidate, "logicalNodeId" | "nodeLocator">,
): LogicalNodeCandidate {
  return {
    name: "sc8562",
    unitAddress: "6E",
    parentLogicalNodeId: parentI2cId,
    driverSchemaVersionId,
    reg: "<0x6e>",
    uniqueKeys: { "i2c-reg": "0x6e" },
    topologyRelation: "child-of:logical-i2c-fdf5e000",
    labels: ["sc8562_chg"],
    ...overrides,
  };
}

describe("ProjectPropertyBindingKey", () => {
  it("keys bindings by project + logical node + parameter spec + module (no recommended value)", () => {
    const key: ProjectPropertyBindingKey = {
      projectId: "project-1",
      logicalNodeId: sc8562Id,
      parameterSpecId: "param:sc8562:gpio_int",
      moduleId: "mod-charging",
    };
    expect(bindingKey(key)).toBe(`project-1\0${sc8562Id}\0param:sc8562:gpio_int\0mod-charging`);

    const values: BindingRevisionValues = {
      typedValue: { kind: "u32", value: 1 },
      canonicalValue: { kind: "u32", value: 1 },
      rawValue: "<1>",
      schemaState: "matched",
      policyState: "ok",
      // schemaDefault lives on the spec version; policyTarget on parameter_policy_targets.
      schemaDefault: undefined,
      policyTarget: undefined,
    };
    expect(values).not.toHaveProperty("recommendedValue");
  });
});

describe("resolveLogicalContinuity", () => {
  it("preserves logical node id when address/path changes with unique evidence", () => {
    const previous = previousSc8562();
    const moved = candidate({
      logicalNodeId: "logical-new-occurrence",
      nodeLocator: "/amba/i2c@MOVED/sc8562@6E",
    });

    const result = resolveLogicalContinuity(previous, [moved]);
    expect(result).toMatchObject({
      kind: "matched",
      // Continuity reuses the previous stable logical identity.
      stableLogicalNodeId: sc8562Id,
      candidateLogicalNodeId: "logical-new-occurrence",
    });
  });

  it("blocks the revision when continuity is ambiguous", () => {
    const previous = previousSc8562();
    const twoEquivalentCandidates = [
      candidate({
        logicalNodeId: "logical-candidate-a",
        nodeLocator: "/amba/i2c@FDF5E000/sc8562@6E",
      }),
      candidate({
        logicalNodeId: "logical-candidate-b",
        nodeLocator: "/amba/i2c@FDF5E000/sc8562_dup@6E",
        name: "sc8562_dup",
      }),
    ];

    const decision = matchLogicalNode(previous, twoEquivalentCandidates);
    expect(decision.kind).toBe("ambiguous");

    const result = resolveLogicalContinuity(previous, twoEquivalentCandidates);
    expect(result).toMatchObject({
      kind: "ambiguous",
      blocksRevision: true,
      revisionStatus: "needs_mapping",
    });
  });
});

describe("persistAmbiguousIdentityMapping", () => {
  it("persists mapping task fields and sets revision to needs_mapping", async () => {
    const previous = previousSc8562();
    const candidates = [
      candidate({
        logicalNodeId: "logical-candidate-a",
        nodeLocator: "/amba/i2c@FDF5E000/sc8562@6E",
      }),
      candidate({
        logicalNodeId: "logical-candidate-b",
        nodeLocator: "/amba/i2c@FDF5E000/sc8562_dup@6E",
        name: "sc8562_dup",
      }),
    ];
    const continuity = resolveLogicalContinuity(previous, candidates);
    expect(continuity.kind).toBe("ambiguous");

    const calls: Array<{ text: string; values: unknown[] }> = [];
    const db: Queryable = {
      query: vi.fn(async (text, values = []) => {
        calls.push({ text, values: values as unknown[] });
        if (text.includes("insert into identity_mapping_tasks")) {
          return {
            rows: [
              {
                id: values[0],
                organization_id: values[1],
                project_id: values[2],
                config_revision_id: values[3],
                previous_logical_node_id: values[4],
                candidate_logical_node_ids: JSON.parse(String(values[5])),
                evidence: JSON.parse(String(values[6])),
                status: values[7],
                reviewer_user_id: values[8],
                reason: values[9],
                created_at: "2026-07-16T00:00:00.000Z",
                resolved_at: null,
              },
            ],
            rowCount: 1,
          };
        }
        if (text.includes("update dts_config_revisions")) {
          return {
            rows: [
              {
                id: values[0],
                organization_id: "org-1",
                project_id: "project-1",
                config_set_id: "dcs-1",
                revision_number: 2,
                status: values[1],
                created_by_user_id: null,
                created_at: "2026-07-16T00:00:00.000Z",
                resolved_at: null,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    if (continuity.kind !== "ambiguous") {
      throw new Error("expected ambiguous continuity");
    }

    const task = await persistAmbiguousIdentityMapping(db, {
      organizationId: "org-1",
      projectId: "project-1",
      configRevisionId: "rev-2",
      previous,
      continuity,
      reason: "two equivalent SC8562 candidates",
    });

    expect(task).toMatchObject({
      status: "open",
      previousLogicalNodeId: sc8562Id,
      configRevisionId: "rev-2",
      candidateLogicalNodeIds: ["logical-candidate-a", "logical-candidate-b"],
      reason: "two equivalent SC8562 candidates",
    });
    expect(task.evidence).toBeTruthy();
    expect(task.createdAt).toBeTruthy();
    expect(calls.some((call) => call.text.includes("identity_mapping_tasks"))).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.text.includes("update dts_config_revisions") && call.values.includes("needs_mapping"),
      ),
    ).toBe(true);
  });
});

type StoredBinding = { id: string; key: ProjectPropertyBindingKey };

/**
 * Minimal in-memory Queryable double for project_parameter_bindings, keyed by the
 * full 4-tuple (project × logical node × parameter spec × module) per phase 2.
 */
function createBindingMockDb(): { db: Queryable; store: Map<string, StoredBinding> } {
  const store = new Map<string, StoredBinding>();
  const revisionStore: unknown[] = [];

  function rowFields(found: StoredBinding) {
    return {
      organization_id: "org-1",
      project_id: found.key.projectId,
      logical_node_id: found.key.logicalNodeId,
      parameter_spec_id: found.key.parameterSpecId,
      module_id: found.key.moduleId,
      created_at: "2026-07-16T00:00:00.000Z",
    };
  }

  const db: Queryable = {
    query: vi.fn(async (text, values = []) => {
      if (text.includes("from project_parameter_bindings") && text.includes("select")) {
        const found = [...store.values()].find(
          (row) =>
            row.key.projectId === values[1] &&
            row.key.logicalNodeId === values[2] &&
            row.key.parameterSpecId === values[3] &&
            row.key.moduleId === values[4] &&
            values[0] === "org-1",
        );
        return { rows: found ? [{ id: found.id, ...rowFields(found) }] : [], rowCount: found ? 1 : 0 };
      }
      if (text.includes("insert into project_parameter_bindings")) {
        const id = String(values[0]);
        const bindingKeyValue: ProjectPropertyBindingKey = {
          projectId: String(values[2]),
          logicalNodeId: (values[3] as string | null) ?? null,
          parameterSpecId: String(values[4]),
          moduleId: String(values[5]),
        };
        store.set(id, { id, key: bindingKeyValue });
        return {
          rows: [
            {
              id,
              organization_id: values[1],
              project_id: values[2],
              logical_node_id: values[3],
              parameter_spec_id: values[4],
              module_id: values[5],
              created_at: "2026-07-16T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes("insert into project_parameter_binding_revisions")) {
        revisionStore.push(values);
        return {
          rows: [
            {
              id: values[0],
              binding_id: values[1],
              config_revision_id: values[2],
              parameter_spec_version_id: values[3],
              typed_value: JSON.parse(String(values[4])),
              canonical_value: values[5] ? JSON.parse(String(values[5])) : null,
              raw_value: values[6],
              schema_state: values[7],
              policy_state: values[8],
              created_at: "2026-07-16T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    }),
  };

  return { db, store };
}

describe("createOrReuseBinding + upsertBindingRevisionValues", () => {
  it("reuses stable binding id across locator/address changes", async () => {
    const key: ProjectPropertyBindingKey = {
      projectId: "project-1",
      logicalNodeId: sc8562Id,
      parameterSpecId: "param:sc8562:gpio_int",
      moduleId: "mod-charging",
    };

    const { db } = createBindingMockDb();

    const first = await createOrReuseBinding(db, {
      organizationId: "org-1",
      key,
    });
    const second = await createOrReuseBinding(db, {
      organizationId: "org-1",
      key: {
        ...key,
        // Same logical node after path move — binding id must stay stable.
        logicalNodeId: sc8562Id,
      },
    });
    expect(second.id).toBe(first.id);

    const revision = await upsertBindingRevisionValues(db, {
      bindingId: first.id,
      configRevisionId: "rev-2",
      parameterSpecVersionId: "psv-1",
      values: {
        typedValue: { kind: "u32", value: 7 },
        canonicalValue: { kind: "u32", value: 7 },
        rawValue: "<7>",
        schemaState: "matched",
        policyState: "ok",
      },
    });
    expect(revision.bindingId).toBe(first.id);
    expect(revision.typedValue).toEqual({ kind: "u32", value: 7 });
    expect(revision).not.toHaveProperty("recommendedValue");
  });
});

describe("createOrReuseBinding reuse-by-module (phase 2)", () => {
  const baseKey: ProjectPropertyBindingKey = {
    projectId: "project-1",
    logicalNodeId: sc8562Id,
    parameterSpecId: "param:sc8562:gpio_int",
    moduleId: "mod-charging",
  };

  it("reuses the same binding id for repeated create calls with an identical 4-tuple key", async () => {
    const { db } = createBindingMockDb();

    const first = await createOrReuseBinding(db, { organizationId: "org-1", key: baseKey });
    const second = await createOrReuseBinding(db, { organizationId: "org-1", key: baseKey });

    expect(second.id).toBe(first.id);
    expect(second.moduleId).toBe("mod-charging");
  });

  it("creates a distinct binding when moduleId differs for the same project+node+spec", async () => {
    const { db, store } = createBindingMockDb();

    const chargingBinding = await createOrReuseBinding(db, { organizationId: "org-1", key: baseKey });
    const batterySafetyBinding = await createOrReuseBinding(db, {
      organizationId: "org-1",
      key: { ...baseKey, moduleId: "mod-battery-safety" },
    });

    expect(batterySafetyBinding.id).not.toBe(chargingBinding.id);
    expect(chargingBinding.moduleId).toBe("mod-charging");
    expect(batterySafetyBinding.moduleId).toBe("mod-battery-safety");
    expect(store.size).toBe(2);
  });

  it("keeps distinct bindings independently reusable by their own module id", async () => {
    const { db } = createBindingMockDb();

    const chargingFirst = await createOrReuseBinding(db, { organizationId: "org-1", key: baseKey });
    await createOrReuseBinding(db, {
      organizationId: "org-1",
      key: { ...baseKey, moduleId: "mod-battery-safety" },
    });
    const chargingAgain = await createOrReuseBinding(db, { organizationId: "org-1", key: baseKey });

    expect(chargingAgain.id).toBe(chargingFirst.id);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import { createAgentInvocation, createUserInvocation } from "../auth/trustedInvocation";
import type { ObjectStore, StoredObject } from "../logs/objectStore";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";

vi.mock("../audit/repository", () => ({
  createAuditEvent: vi.fn(async () => undefined)
}));

import { createAuditEvent } from "../audit/repository";
import { insertReloadRun, insertReloadRunTarget, readLibraryFingerprint } from "./repository";
import {
  getReloadRun,
  listReloadCandidates,
  startReloadRun as startReloadRunService,
  type DtsReloadServiceContext
} from "./service";

const databaseAvailable = await isTestDatabaseAvailable();

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Hardware Committer",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: "project-1", roleId: "hardware-committer" }],
    permissions: ["debugging:dts-reload"],
    ...overrides
  };
}

function makeObjectStore(files: Record<string, Buffer> = {}) {
  const put = vi.fn(async (input: Parameters<ObjectStore["put"]>[0]): Promise<StoredObject> => {
    const storageKey = `${input.organizationId}/${input.fileName}`;
    files[storageKey] = input.bytes;
    return {
      storageKey,
      fileName: input.fileName,
      contentType: input.contentType,
      fileSizeBytes: input.bytes.byteLength,
      checksumSha256: `sha-${input.fileName}`
    };
  });
  const get = vi.fn(async (storageKey: string) => {
    const found = files[storageKey];
    if (!found) throw new Error(`missing ${storageKey}`);
    return found;
  });
  return { objectStore: { put, get } as ObjectStore, put, get, files };
}

function userContext(principal: AuthContext, requestId: string, refusalDb: Database): DtsReloadServiceContext {
  return { invocation: createUserInvocation(principal), requestId, refusalDb };
}

function agentContext(principal: AuthContext, requestId: string, refusalDb: Database): DtsReloadServiceContext {
  return {
    invocation: createAgentInvocation(principal, {
      sessionId: "session-dts-reload",
      toolCallId: "tool-dts-reload",
      approval: { required: true, approvalId: "approval-dts-reload" }
    }),
    requestId,
    refusalDb
  };
}

function startReloadRun(
  db: Parameters<typeof startReloadRunService>[0],
  objectStore: Parameters<typeof startReloadRunService>[1],
  principal: Parameters<typeof startReloadRunService>[2],
  input: Parameters<typeof startReloadRunService>[3],
  context: Parameters<typeof startReloadRunService>[4] = userContext(principal, "req-dts-user", db)
) {
  return startReloadRunService(db, objectStore, principal, input, context);
}

const BASE_DTS = `/dts-v1/;

/ {
\tamba {
\t\ti2c@FDF5E000 {
\t\t\tsc8562@6E {
\t\t\t\twatchdog_time = <6000>;
\t\t\t};
\t\t};
\t};
};
`;

// dts_property_specs refuses structural keys ("status", "reg", …); those candidates derive
// their property key from the parameter_specs specification_key tail instead.
const STRUCTURAL_PROPERTY_KEYS = new Set([
  "compatible",
  "device_type",
  "gpio-controller",
  "interrupt-controller",
  "linux,phandle",
  "phandle",
  "ranges",
  "reg",
  "status"
]);

describe.skipIf(!databaseAvailable)("dts-reload service", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    vi.mocked(createAuditEvent).mockClear();
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Riley Chen", email: "riley@example.com" }],
      projects: [{ id: "project-1" }]
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  /**
   * Seed the parameter-library graph behind one reload candidate binding
   * (module → spec → spec version → dts property spec → logical node → binding → revision).
   * Defaults mirror the file's historical `candidateRow()` fixture.
   */
  async function seedCandidate(input: {
    bindingId: string;
    propertyKey?: string;
    displayName?: string;
    nodePath?: string | null;
    compatible?: string | null;
    configRevisionId?: string;
    baselineValue?: string | null;
    description?: string | null;
    valueShape?: Record<string, unknown>;
    unit?: string | null;
    constraints?: Record<string, unknown>;
  }) {
    const propertyKey = input.propertyKey ?? "watchdog_time";
    const nodePath = input.nodePath === undefined ? "/amba/i2c@FDF5E000/sc8562@6E" : input.nodePath;
    const configRevisionId = input.configRevisionId ?? "rev-1";

    await db.query(
      `insert into parameter_modules (id, organization_id, name, path)
       values ('mod-charger', 'org-1', 'charger', '/charger')
       on conflict (id) do nothing`
    );
    await db.query(
      `insert into dts_config_set (id, organization_id, project_id, name)
       values ('cs-1', 'org-1', 'project-1', 'primary') on conflict (id) do nothing`
    );
    await db.query(
      `insert into dts_config_revisions (id, organization_id, project_id, config_set_id, revision_number, status)
       select $1, 'org-1', 'project-1', 'cs-1',
              coalesce((select max(revision_number) from dts_config_revisions where config_set_id = 'cs-1'), 0) + 1,
              'compiled'
       where not exists (select 1 from dts_config_revisions where id = $1)`,
      [configRevisionId]
    );
    await db.query(
      `insert into parameter_specs (id, organization_id, source_kind, specification_key)
       values ($1, 'org-1', 'dts', $2)`,
      [`spec-${input.bindingId}`, `reload/${input.bindingId}/${propertyKey}`]
    );
    await db.query(
      `insert into parameter_spec_versions (
         id, parameter_spec_id, version, display_name, description, documentation, value_shape, units, lifecycle
       ) values ($1, $2, 1, $3, '', $4, $5::jsonb, $6, 'active')`,
      [
        `psv-${input.bindingId}`,
        `spec-${input.bindingId}`,
        input.displayName ?? "Watchdog",
        input.description === undefined ? "Watchdog timeout for charger safety." : input.description,
        JSON.stringify(input.valueShape ?? { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 }),
        input.unit === undefined ? "ms" : input.unit
      ]
    );
    if (!STRUCTURAL_PROPERTY_KEYS.has(propertyKey)) {
      await db.query(
        `insert into dts_property_specs (id, parameter_spec_id, property_key, schema_namespace, constraints)
         values ($1, $2, $3, 'reload-test', $4::jsonb)`,
        [
          `dps-${input.bindingId}`,
          `spec-${input.bindingId}`,
          propertyKey,
          JSON.stringify(input.constraints ?? { min: 0, max: 20000, cells: 1 })
        ]
      );
    }
    if (nodePath !== null) {
      await db.query(
        `insert into dts_logical_nodes (id, organization_id, project_id, config_set_id)
         values ($1, 'org-1', 'project-1', 'cs-1')`,
        [`node-${input.bindingId}`]
      );
      await db.query(
        `insert into dts_logical_node_revisions (id, logical_node_id, config_revision_id, node_locator, name, compatible)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          `lnr-${input.bindingId}`,
          `node-${input.bindingId}`,
          configRevisionId,
          nodePath,
          nodePath.split("/").filter(Boolean).at(-1) ?? "node",
          input.compatible === undefined ? "sc8562" : input.compatible
        ]
      );
    }
    await db.query(
      `insert into project_parameter_bindings (id, organization_id, project_id, logical_node_id, parameter_spec_id, module_id)
       values ($1, 'org-1', 'project-1', $2, $3, 'mod-charger')`,
      [input.bindingId, nodePath === null ? null : `node-${input.bindingId}`, `spec-${input.bindingId}`]
    );
    await db.query(
      `insert into project_parameter_binding_revisions (
         id, binding_id, config_revision_id, parameter_spec_version_id, typed_value, raw_value
       ) values ($1, $2, $3, $4, '{}'::jsonb, $5)`,
      [
        `bpr-${input.bindingId}`,
        input.bindingId,
        configRevisionId,
        `psv-${input.bindingId}`,
        input.baselineValue === undefined ? "<6000>" : input.baselineValue
      ]
    );
  }

  /** Register `board.dts` as the project's base config-set member pointing at `org-1/board.dts`. */
  async function seedBaseDtsFile() {
    await db.query(
      `insert into dts_config_set (id, organization_id, project_id, name)
       values ('cs-1', 'org-1', 'project-1', 'primary') on conflict (id) do nothing`
    );
    await db.query(
      `insert into project_parameter_files (
         id, organization_id, project_id, file_name, format, enabled,
         config_set_id, config_set_role, config_set_sort_order
       ) values ('file-base', 'org-1', 'project-1', 'board.dts', 'dts', true, 'cs-1', 'base', 0)`
    );
    await db.query(
      `insert into project_parameter_file_versions (
         id, file_id, version_number, storage_key, checksum, size_bytes, origin, created_by_user_id
       ) values ('filev-base', 'file-base', 1, 'org-1/board.dts', 'checksum-base', 128, 'upload', 'user-1')`
    );
    await db.query(`update project_parameter_files set current_version_id = 'filev-base' where id = 'file-base'`);
  }

  async function seedSensitiveRule(overrides: Record<string, unknown> = {}) {
    const rule = {
      id: "rule-1",
      organization_id: "org-1",
      project_id: null,
      match_type: "path",
      pattern: "/amba/i2c@FDF5E000/sc8562@6E",
      risk_tier: "high",
      required_capability: "parameter:edit-critical",
      enabled: true,
      ...overrides
    };
    await db.query(
      `insert into dts_sensitive_node_rules (
         id, organization_id, project_id, match_type, pattern, risk_tier, required_capability, enabled
       ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        rule.id,
        rule.organization_id,
        rule.project_id,
        rule.match_type,
        rule.pattern,
        rule.risk_tier,
        rule.required_capability,
        rule.enabled
      ]
    );
  }

  async function reloadRunCount(): Promise<number> {
    const result = await db.query<{ count: string }>(
      "select count(*)::text as count from dts_reload_runs where organization_id = $1",
      ["org-1"]
    );
    return Number(result.rows[0].count);
  }

  describe("dts-reload policy gate", () => {
    it("refuses callers lacking debugging:view for candidate reads", async () => {
      await expect(listReloadCandidates(db, auth({ permissions: [] }), "project-1")).rejects.toMatchObject({
        code: "FORBIDDEN",
        details: { permission: "debugging:view" }
      });
    });
  });

  describe("listReloadCandidates", () => {
    it("returns library baseline values and constraints with debuggable classification", async () => {
      await seedCandidate({ bindingId: "binding-1" });
      await seedCandidate({
        bindingId: "binding-2",
        nodePath: "/amba",
        propertyKey: "status"
      });

      const result = await listReloadCandidates(db, auth(), "project-1");
      expect(result.items).toHaveLength(2);
      expect(result.items.find((item) => item.bindingId === "binding-1")).toMatchObject({
        bindingId: "binding-1",
        baselineValue: "<6000>",
        description: "Watchdog timeout for charger safety.",
        constraints: { min: 0, max: 20000, cells: 1 },
        debuggable: true,
        sensitiveMatch: null,
        // Resolved shape is exposed so clients validate against the reload vocabulary.
        resolvedValueShape: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 }
      });
      expect(result.items.find((item) => item.bindingId === "binding-2")).toMatchObject({
        bindingId: "binding-2",
        debuggable: true,
        nodePath: "/amba",
        sensitiveMatch: null
      });
    });

    it("collapses duplicate overlay identities and prefers the debuggable row", async () => {
      await seedCandidate({
        bindingId: "binding-stale",
        propertyKey: "active_perf_limit",
        displayName: "active_perf_limit",
        nodePath: "/hisi_vbat_drop_protect_v2/middle_cpu",
        valueShape: { kind: "u32-array" },
        baselineValue: null,
        constraints: {},
        description: null
      });
      await seedCandidate({
        bindingId: "binding-ok",
        propertyKey: "active_perf_limit",
        displayName: "active_perf_limit",
        nodePath: "/hisi_vbat_drop_protect_v2/middle_cpu",
        valueShape: { kind: "u32-array" },
        baselineValue: "<16 100 100 6 15 100 0 5 100>",
        constraints: {},
        description: null
      });
      await seedCandidate({
        bindingId: "binding-null-path",
        propertyKey: "active_perf_limit",
        displayName: "active_perf_limit",
        nodePath: null,
        valueShape: { kind: "u32-array" },
        baselineValue: "<16 100 100 6 15 100 0 5 100>",
        constraints: {},
        description: null
      });

      const result = await listReloadCandidates(db, auth(), "project-1");
      expect(result.items).toHaveLength(2);
      const withPath = result.items.find((item) => item.nodePath);
      expect(withPath).toMatchObject({
        bindingId: "binding-ok",
        debuggable: true,
        propertyKey: "active_perf_limit"
      });
      expect(result.items.find((item) => item.nodePath == null)?.bindingId).toBe("binding-null-path");
    });

    it("marks incomplete u32-array catalog shapes debuggable when baseline width is regular", async () => {
      await seedCandidate({
        bindingId: "binding-1",
        propertyKey: "active_perf_limit",
        valueShape: { kind: "u32-array" },
        baselineValue: "<16 100 100 6 15 100 0 5 100>",
        constraints: {}
      });

      const result = await listReloadCandidates(db, auth(), "project-1");
      expect(result.items[0]).toMatchObject({
        debuggable: true,
        valueShapeKind: "u32-array"
      });
    });

    it("marks GPIO-style mixed gpio_int candidates as debuggable", async () => {
      await seedCandidate({
        bindingId: "binding-1",
        propertyKey: "gpio_int",
        displayName: "gpio_int",
        valueShape: { kind: "mixed" },
        baselineValue: "<&gpio13 29 0>",
        constraints: { cells: 3 },
        description: "SC8562 interrupt GPIO"
      });

      const result = await listReloadCandidates(db, auth(), "project-1");
      expect(result.items[0]).toMatchObject({
        propertyKey: "gpio_int",
        valueShapeKind: "mixed",
        debuggable: true,
        baselineValue: "<&gpio13 29 0>"
      });
    });

    it("marks catalog bytes /bits/ 8 candidates as debuggable", async () => {
      await seedCandidate({
        bindingId: "binding-1",
        propertyKey: "prevfod1_product_list",
        displayName: "prevfod1_product_list",
        nodePath: "/amba/i2c@FF24E000/mt5788@2B",
        valueShape: { kind: "bytes" },
        baselineValue: "/bits/ 8 <17>",
        constraints: {},
        unit: null,
        description: "product list"
      });

      const result = await listReloadCandidates(db, auth(), "project-1");
      expect(result.items[0]).toMatchObject({
        propertyKey: "prevfod1_product_list",
        valueShapeKind: "bytes",
        debuggable: true,
        baselineValue: "/bits/ 8 <17>"
      });
    });

    it("exposes server-computed sensitive matches so the UI can mark elevated requirements before start", async () => {
      await seedCandidate({ bindingId: "binding-1" });
      await seedSensitiveRule({
        risk_tier: "critical",
        pattern: "/amba/i2c@FDF5E000/sc8562@6E"
      });

      const result = await listReloadCandidates(db, auth(), "project-1");
      expect(result.items[0]?.sensitiveMatch).toMatchObject({
        riskTier: "critical",
        requiredCapability: "parameter:edit-critical",
        ruleId: "rule-1",
        requiresElevatedCapability: true,
        requiresConfirmation: true
      });
    });
  });

  describe("startReloadRun", () => {
    it("refuses a debug value outside declared constraints before involving the toolchain", async () => {
      await seedCandidate({ bindingId: "binding-1" });
      const { objectStore, put } = makeObjectStore();

      await expect(
        startReloadRun(db, objectStore, auth(), {
          projectId: "project-1",
          targets: [{ bindingId: "binding-1", debugValue: "<99999>" }]
        })
      ).rejects.toBeInstanceOf(ApiError);

      expect(put).not.toHaveBeenCalled();
      expect(await reloadRunCount()).toBe(0);
    });

    it("refuses a not-debuggable parameter through the API", async () => {
      await seedCandidate({ bindingId: "binding-bad", nodePath: null });
      const { objectStore, put } = makeObjectStore();

      await expect(
        startReloadRun(db, objectStore, auth(), {
          projectId: "project-1",
          targets: [{ bindingId: "binding-bad", debugValue: "<7000>" }]
        })
      ).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        details: { blockReason: "no-node-path" }
      });
      expect(put).not.toHaveBeenCalled();
    });

    it("refuses a multi-string debug value when the catalog shape is a single string", async () => {
      await seedCandidate({
        bindingId: "binding-1",
        propertyKey: "replace_sensor",
        valueShape: { kind: "string" },
        baselineValue: '"bat0_raw_temp"',
        constraints: {}
      });
      const { objectStore, put } = makeObjectStore();

      await expect(
        startReloadRun(db, objectStore, auth(), {
          projectId: "project-1",
          targets: [{ bindingId: "binding-1", debugValue: '"a", "b"' }]
        })
      ).rejects.toMatchObject({
        code: "VALIDATION_FAILED"
      });

      expect(put).not.toHaveBeenCalled();
      expect(await reloadRunCount()).toBe(0);
    });

    it("refuses a debug value whose cell dimensions do not match the declared value shape", async () => {
      await seedCandidate({
        bindingId: "binding-1",
        valueShape: { kind: "cells", bits: 32, cellsPerGroup: 3, groups: 1 },
        constraints: {}
      });
      const { objectStore, put } = makeObjectStore();

      await expect(
        startReloadRun(db, objectStore, auth(), {
          projectId: "project-1",
          targets: [{ bindingId: "binding-1", debugValue: "<1 2>" }]
        })
      ).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        details: { expectedCellsPerGroup: 3 }
      });

      expect(put).not.toHaveBeenCalled();
      expect(await reloadRunCount()).toBe(0);
    });

    it("refuses a debug value beyond the unsigned range of the declared cell width", async () => {
      await seedCandidate({
        bindingId: "binding-1",
        propertyKey: "prevfod1_product_list",
        nodePath: "/amba/i2c@FF24E000/mt5788@2B",
        valueShape: { kind: "bytes" },
        baselineValue: "/bits/ 8 <17>",
        constraints: {}
      });
      const { objectStore, put } = makeObjectStore();

      await expect(
        startReloadRun(db, objectStore, auth(), {
          projectId: "project-1",
          targets: [{ bindingId: "binding-1", debugValue: "/bits/ 8 <300>" }]
        })
      ).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        message: expect.stringContaining('Integer literal "300" overflows a 8-bit cell'),
        details: { bindingId: "binding-1", debugValue: "/bits/ 8 <300>" }
      });

      expect(put).not.toHaveBeenCalled();
      expect(await reloadRunCount()).toBe(0);
    });

    it("infers cellsPerGroup from baseline for incomplete u32-array shapes during start", async () => {
      await seedCandidate({
        bindingId: "binding-1",
        propertyKey: "active_perf_limit",
        valueShape: { kind: "u32-array" },
        baselineValue: "<16 100 100 6 15 100 0 5 100>",
        constraints: {}
      });
      const { objectStore, put } = makeObjectStore();

      await expect(
        startReloadRun(db, objectStore, auth(), {
          projectId: "project-1",
          targets: [{ bindingId: "binding-1", debugValue: "<1 2 3>" }]
        })
      ).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        details: { expectedCellsPerGroup: 9 }
      });

      expect(put).not.toHaveBeenCalled();
      expect(await reloadRunCount()).toBe(0);
    });

    it("refuses a GPIO phandle debug value whose cell width does not match the baseline shape", async () => {
      await seedCandidate({
        bindingId: "binding-1",
        propertyKey: "gpio_int",
        valueShape: { kind: "mixed" },
        baselineValue: "<&gpio13 29 0>",
        constraints: { cells: 3 }
      });
      const { objectStore, put } = makeObjectStore();

      await expect(
        startReloadRun(db, objectStore, auth(), {
          projectId: "project-1",
          targets: [{ bindingId: "binding-1", debugValue: "<&gpio13 29>" }]
        })
      ).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        details: { expectedCellsPerGroup: 3 }
      });

      expect(put).not.toHaveBeenCalled();
      expect(await reloadRunCount()).toBe(0);
    });

    it("refuses a /bits/ 8 debug value whose width does not match the baseline", async () => {
      await seedCandidate({
        bindingId: "binding-1",
        propertyKey: "prevfod1_product_list",
        nodePath: "/amba/i2c@FF24E000/mt5788@2B",
        valueShape: { kind: "bytes" },
        baselineValue: "/bits/ 8 <17>",
        constraints: {}
      });
      const { objectStore, put } = makeObjectStore();

      await expect(
        startReloadRun(db, objectStore, auth(), {
          projectId: "project-1",
          targets: [{ bindingId: "binding-1", debugValue: "/bits/ 8 <1 2>" }]
        })
      ).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        details: { expectedCellsPerGroup: 1 }
      });

      expect(put).not.toHaveBeenCalled();
      expect(await reloadRunCount()).toBe(0);
    });

    it("persists a validated gpio_int phandle-cells reload", async () => {
      const baseKey = "org-1/board.dts";
      const gpioBase =
        "/dts-v1/;\n\n/ {\n\tgpiol13: gpio13 {\n\t};\n\tamba {\n\t\ti2c@FDF5E000 {\n\t\t\tsc8562@6E {\n\t\t\t\tgpio_int = <&gpio13 29 0>;\n\t\t\t};\n\t\t};\n\t};\n};\n".replace(
          "gpiol13:",
          "gpio13:"
        );
      const { objectStore, files } = makeObjectStore({ [baseKey]: Buffer.from(gpioBase, "utf8") });

      await seedCandidate({
        bindingId: "binding-1",
        propertyKey: "gpio_int",
        displayName: "gpio_int",
        valueShape: { kind: "mixed" },
        baselineValue: "<&gpio13 29 0>",
        constraints: { cells: 3 },
        unit: null
      });
      await seedBaseDtsFile();

      const result = await startReloadRun(db, objectStore, auth(), {
        projectId: "project-1",
        targets: [{ bindingId: "binding-1", debugValue: "<&gpio13 30 0>" }]
      });

      expect(result.status).toBe("validated");
      expect(result.overlaySource).toContain("gpio_int = <&gpio13 30 0>");
      expect(result.overlaySource).toContain('target-path = "/amba/i2c@FDF5E000/sc8562@6E"');
      expect(result.artifact?.sha256).toMatch(/^sha-/);
      expect(Object.keys(files).some((key) => key.endsWith(".dtbo"))).toBe(true);
    }, 60_000);

    it("persists a validated /bits/ 8 bytes reload for prevfod1_product_list", async () => {
      const baseKey = "org-1/board.dts";
      const bitsBase = `/dts-v1/;

/ {
\tamba {
\t\ti2c@FF24E000 {
\t\t\tmt5788@2B {
\t\t\t\tprevfod1_product_list = /bits/ 8 <17>;
\t\t\t};
\t\t};
\t};
};
`;
      const { objectStore, files } = makeObjectStore({ [baseKey]: Buffer.from(bitsBase, "utf8") });

      await seedCandidate({
        bindingId: "binding-1",
        propertyKey: "prevfod1_product_list",
        displayName: "prevfod1_product_list",
        nodePath: "/amba/i2c@FF24E000/mt5788@2B",
        valueShape: { kind: "bytes" },
        baselineValue: "/bits/ 8 <17>",
        constraints: {},
        unit: null
      });
      await seedBaseDtsFile();

      const result = await startReloadRun(db, objectStore, auth(), {
        projectId: "project-1",
        targets: [{ bindingId: "binding-1", debugValue: "/bits/ 8 <34>" }]
      });

      expect(result.status).toBe("validated");
      expect(result.overlaySource).toContain("prevfod1_product_list = /bits/ 8 <34>");
      expect(result.artifact?.sha256).toMatch(/^sha-/);
      expect(Object.keys(files).some((key) => key.endsWith(".dtbo"))).toBe(true);
    }, 60_000);

    it("persists a validated single-string reload for replace_sensor", async () => {
      const baseKey = "org-1/board.dts";
      const stringBase = `/dts-v1/;

/ {
\tbattery_temp_fitting {
\t\treplace_sensor = "bat0_raw_temp";
\t};
};
`;
      const { objectStore, files } = makeObjectStore({ [baseKey]: Buffer.from(stringBase, "utf8") });

      await seedCandidate({
        bindingId: "binding-1",
        propertyKey: "replace_sensor",
        displayName: "replace_sensor",
        nodePath: "/battery_temp_fitting",
        valueShape: { kind: "string" },
        baselineValue: '"bat0_raw_temp"',
        constraints: {},
        unit: null
      });
      await seedBaseDtsFile();

      const result = await startReloadRun(db, objectStore, auth(), {
        projectId: "project-1",
        targets: [{ bindingId: "binding-1", debugValue: '"bat1_raw_temp"' }]
      });

      expect(result.status).toBe("validated");
      expect(result.overlaySource).toContain('replace_sensor = "bat1_raw_temp"');
      expect(result.overlaySource).toContain('target-path = "/battery_temp_fitting"');
      expect(result.artifact?.sha256).toMatch(/^sha-/);
      expect(Object.keys(files).some((key) => key.endsWith(".dtbo"))).toBe(true);
    }, 60_000);

    it("refuses a batch that targets the same overlay path and property twice", async () => {
      await seedCandidate({
        bindingId: "binding-a",
        propertyKey: "active_perf_limit",
        valueShape: { kind: "u32-array" },
        baselineValue: "<16 100 100 6 15 100 0 5 100>",
        constraints: {}
      });
      await seedCandidate({
        bindingId: "binding-b",
        propertyKey: "active_perf_limit",
        valueShape: { kind: "u32-array" },
        baselineValue: "<16 100 100 6 15 100 0 5 100>",
        constraints: {}
      });
      const { objectStore, put } = makeObjectStore();

      await expect(
        startReloadRun(db, objectStore, auth(), {
          projectId: "project-1",
          targets: [
            { bindingId: "binding-a", debugValue: "<16 100 100 6 15 100 0 5 100>" },
            { bindingId: "binding-b", debugValue: "<17 100 100 6 15 100 0 5 100>" }
          ]
        })
      ).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        details: { code: "reload-duplicate-overlay-target" }
      });
      expect(put).not.toHaveBeenCalled();
    });

    it("blocks the whole batch when one target violates constraints", async () => {
      await seedCandidate({ bindingId: "binding-1" });
      await seedCandidate({
        bindingId: "binding-2",
        propertyKey: "vout_ovp_mv",
        constraints: { min: 0, max: 10000, cells: 1 }
      });
      const { objectStore, put } = makeObjectStore();

      await expect(
        startReloadRun(db, objectStore, auth(), {
          projectId: "project-1",
          targets: [
            { bindingId: "binding-1", debugValue: "<7000>" },
            { bindingId: "binding-2", debugValue: "<99999>" }
          ]
        })
      ).rejects.toBeInstanceOf(ApiError);

      expect(put).not.toHaveBeenCalled();
      expect(await reloadRunCount()).toBe(0);
    });

    it("persists a validated multi-node batch with one fragment per node", async () => {
      const baseKey = "org-1/board.dts";
      const multiBase = `/dts-v1/;

/ {
\tamba {
\t\ti2c@FDF5E000 {
\t\t\tsc8562@6E {
\t\t\t\twatchdog_time = <6000>;
\t\t\t\tvout_ovp_mv = <5000>;
\t\t\t};
\t\t};
\t\tuart@FDF02000 {
\t\t\tcurrent-speed = <9600>;
\t\t};
\t};
};
`;
      const { objectStore, files } = makeObjectStore({ [baseKey]: Buffer.from(multiBase, "utf8") });

      await seedCandidate({ bindingId: "binding-1" });
      await seedCandidate({
        bindingId: "binding-2",
        propertyKey: "vout_ovp_mv",
        baselineValue: "<5000>",
        constraints: { min: 0, max: 20000, cells: 1 }
      });
      await seedCandidate({
        bindingId: "binding-3",
        propertyKey: "current-speed",
        nodePath: "/amba/uart@FDF02000",
        baselineValue: "<9600>",
        constraints: { min: 0, max: 4000000, cells: 1 }
      });
      await seedBaseDtsFile();

      const result = await startReloadRun(db, objectStore, auth(), {
        projectId: "project-1",
        targets: [
          { bindingId: "binding-1", debugValue: "<7000>" },
          { bindingId: "binding-2", debugValue: "<0x1770>" },
          { bindingId: "binding-3", debugValue: "<115200>" }
        ]
      });

      expect(result.status).toBe("validated");
      expect(result.overlaySource).toContain("fragment@0");
      expect(result.overlaySource).toContain("fragment@1");
      expect(result.overlaySource).toContain("watchdog_time = <7000>");
      expect(result.overlaySource).toContain("vout_ovp_mv = <0x1770>");
      expect(result.overlaySource).toContain("current-speed = <115200>");
      expect(result.overlaySource).not.toMatch(/^&/m);
      expect(result.artifact?.sha256).toMatch(/^sha-/);
      expect(Object.keys(files).some((key) => key.endsWith(".dtbo"))).toBe(true);

      const targets = await db.query<{ binding_id: string; debug_value: string }>(
        "select binding_id, debug_value from dts_reload_run_targets where reload_run_id = $1 order by sort_order asc",
        [result.id]
      );
      expect(targets.rows).toEqual([
        { binding_id: "binding-1", debug_value: "<7000>" },
        { binding_id: "binding-2", debug_value: "<0x1770>" },
        { binding_id: "binding-3", debug_value: "<115200>" }
      ]);
    }, 60_000);

    it("persists a validated run with overlay source and artifact, and leaves the library fingerprint unchanged", async () => {
      const baseKey = "org-1/board.dts";
      const { objectStore, files } = makeObjectStore({ [baseKey]: Buffer.from(BASE_DTS, "utf8") });

      await seedCandidate({ bindingId: "binding-1" });
      await seedBaseDtsFile();
      const fingerprintBefore = await readLibraryFingerprint(db, {
        organizationId: "org-1",
        projectId: "project-1"
      });

      const result = await startReloadRun(db, objectStore, auth(), {
        projectId: "project-1",
        targets: [{ bindingId: "binding-1", debugValue: "<7000>" }]
      });

      expect(result.status).toBe("validated");
      expect(result.configRevisionId).toBe("rev-1");
      expect(result.overlaySource).toContain('target-path = "/amba/i2c@FDF5E000/sc8562@6E"');
      expect(result.overlaySource).not.toMatch(/^&/m);
      expect(result.overlaySource).toContain("watchdog_time = <7000>");
      expect(result.artifact?.sha256).toMatch(/^sha-/);
      expect(Object.keys(files).some((key) => key.endsWith(".dtbo"))).toBe(true);
      expect(vi.mocked(createAuditEvent).mock.calls.map((call) => call[1].kind)).toEqual([
        "dts-reload-run-start",
        "dts-reload-run-validated"
      ]);

      // The run persisted; the parameter library it read from is byte-for-byte untouched.
      const persisted = await db.query<{ status: string; failure_code: string | null }>(
        "select status, failure_code from dts_reload_runs where id = $1",
        [result.id]
      );
      expect(persisted.rows).toEqual([{ status: "validated", failure_code: null }]);
      const fingerprintAfter = await readLibraryFingerprint(db, {
        organizationId: "org-1",
        projectId: "project-1"
      });
      expect(fingerprintAfter).toEqual(fingerprintBefore);
    }, 60_000);

    it("blocks a wrong node path as a blocked run rather than completing", async () => {
      const baseKey = "org-1/board.dts";
      const { objectStore } = makeObjectStore({ [baseKey]: Buffer.from(BASE_DTS, "utf8") });

      await seedCandidate({ bindingId: "binding-1", nodePath: "/amba/i2c@WRONG/sc8562@6E" });
      await seedBaseDtsFile();

      const result = await startReloadRun(db, objectStore, auth(), {
        projectId: "project-1",
        targets: [{ bindingId: "binding-1", debugValue: "<7000>" }]
      });

      expect(result.status).toBe("blocked");
      expect(result.artifact).toBeNull();
      expect(
        result.diagnostics.some((d) => d.nodePath?.includes("WRONG") || /WRONG|does not exist/i.test(d.message))
      ).toBe(true);
      expect(vi.mocked(createAuditEvent).mock.calls.map((call) => call[1].kind)).toEqual([
        "dts-reload-run-start",
        "dts-reload-run-blocked"
      ]);

      const persisted = await db.query<{ status: string }>(
        "select status from dts_reload_runs where id = $1",
        [result.id]
      );
      expect(persisted.rows).toEqual([{ status: "blocked" }]);
    }, 60_000);

    it("blocks a misspelled property name via the property-existence assertion", async () => {
      const baseKey = "org-1/board.dts";
      const { objectStore } = makeObjectStore({ [baseKey]: Buffer.from(BASE_DTS, "utf8") });

      await seedCandidate({ bindingId: "binding-1", propertyKey: "watchdog_tyme" });
      await seedBaseDtsFile();

      const result = await startReloadRun(db, objectStore, auth(), {
        projectId: "project-1",
        targets: [{ bindingId: "binding-1", debugValue: "<7000>" }]
      });

      expect(result.status).toBe("blocked");
      expect(result.failureCode).toBe("property-absent-in-base");
      expect(result.diagnostics.some((d) => d.code === "property-absent-in-base")).toBe(true);
    }, 60_000);
  });

  describe("startReloadRun sensitive-node governance", () => {
    const elevatedAuth = () =>
      auth({ permissions: ["debugging:dts-reload", "parameter:edit-critical"] });

    it("refuses a high-tier match when the caller has only debugging:dts-reload", async () => {
      await seedCandidate({ bindingId: "binding-1" });
      await seedSensitiveRule({ risk_tier: "high" });
      const { objectStore, put } = makeObjectStore();

      await expect(
        startReloadRun(db, objectStore, auth(), {
          projectId: "project-1",
          targets: [{ bindingId: "binding-1", debugValue: "<7000>" }]
        })
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403,
        details: {
          code: "sensitive-node-reload-denied",
          riskTier: "high",
          bindingId: "binding-1",
          requiredCapability: "parameter:edit-critical",
          reason: "missing-capability"
        }
      });

      expect(put).not.toHaveBeenCalled();
      expect(await reloadRunCount()).toBe(0);
      expect(createAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          kind: "dts-reload-sensitive-node-denied",
          action: "deny",
          severity: "High",
          metadata: expect.objectContaining({
            reason: "missing-capability",
            riskTier: "high",
            bindingId: "binding-1"
          })
        })
      );
    });

    it("allows a high-tier match when the caller also has parameter:edit-critical", async () => {
      const baseKey = "org-1/board.dts";
      const { objectStore } = makeObjectStore({ [baseKey]: Buffer.from(BASE_DTS, "utf8") });
      await seedCandidate({ bindingId: "binding-1" });
      await seedSensitiveRule({ risk_tier: "high" });
      await seedBaseDtsFile();

      const result = await startReloadRun(db, objectStore, elevatedAuth(), {
        projectId: "project-1",
        targets: [{ bindingId: "binding-1", debugValue: "<7000>" }]
      });
      expect(result.status).toBe("validated");
    }, 60_000);

    it("refuses a critical-tier match without confirmation even with elevated capability", async () => {
      await seedCandidate({ bindingId: "binding-1" });
      await seedSensitiveRule({ risk_tier: "critical" });
      const { objectStore, put } = makeObjectStore();

      await expect(
        startReloadRun(db, objectStore, elevatedAuth(), {
          projectId: "project-1",
          targets: [{ bindingId: "binding-1", debugValue: "<7000>" }]
        })
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        details: {
          code: "sensitive-node-reload-denied",
          riskTier: "critical",
          reason: "missing-confirmation",
          requireConfirmation: true,
          expectedConfirmationToken: "confirm-sensitive-reload"
        }
      });
      expect(put).not.toHaveBeenCalled();
      expect(createAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          kind: "dts-reload-sensitive-node-denied",
          metadata: expect.objectContaining({ reason: "missing-confirmation" })
        })
      );
    });

    it("allows a critical-tier match with elevated capability plus confirm-sensitive-reload and audits High", async () => {
      const baseKey = "org-1/board.dts";
      const { objectStore } = makeObjectStore({ [baseKey]: Buffer.from(BASE_DTS, "utf8") });
      await seedCandidate({ bindingId: "binding-1" });
      await seedSensitiveRule({ risk_tier: "critical" });
      await seedBaseDtsFile();

      const result = await startReloadRun(
        db,
        objectStore,
        elevatedAuth(),
        {
          projectId: "project-1",
          targets: [{ bindingId: "binding-1", debugValue: "<7000>" }],
          confirmationToken: "confirm-sensitive-reload"
        }
      );
      expect(result.status).toBe("validated");
      expect(createAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          kind: "dts-reload-run-start",
          severity: "High",
          metadata: expect.objectContaining({
            sensitiveMatches: [
              expect.objectContaining({
                ruleId: "rule-1",
                riskTier: "critical",
                pattern: "/amba/i2c@FDF5E000/sc8562@6E"
              })
            ]
          })
        })
      );
    }, 60_000);

    it("refuses an agent actor for start even without a sensitive match and audits the refusal", async () => {
      await seedCandidate({ bindingId: "binding-1" });
      const { objectStore, put } = makeObjectStore();

      await expect(
        startReloadRun(
          db,
          objectStore,
          auth(),
          {
            projectId: "project-1",
            targets: [{ bindingId: "binding-1", debugValue: "<7000>" }]
          },
          agentContext(auth(), "req-dts-agent", db)
        )
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        details: {
          code: "dts-reload-agent-refused",
          reason: "agent-refused",
          requireHuman: true,
          action: "start"
        }
      });
      expect(put).not.toHaveBeenCalled();
      expect(createAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          actorType: "agent",
          kind: "dts-reload-agent-refused",
          action: "deny",
          metadata: expect.objectContaining({
            reason: "agent-refused",
            requireHuman: true,
            action: "start"
          })
        })
      );
    });

    it("refuses an agent actor for any sensitive match and audits requireHuman", async () => {
      await seedCandidate({ bindingId: "binding-1" });
      await seedSensitiveRule({ risk_tier: "high" });
      const { objectStore, put } = makeObjectStore();

      await expect(
        startReloadRun(
          db,
          objectStore,
          elevatedAuth(),
          {
            projectId: "project-1",
            targets: [{ bindingId: "binding-1", debugValue: "<7000>" }],
            confirmationToken: "confirm-sensitive-reload"
          },
          agentContext(elevatedAuth(), "req-dts-agent", db)
        )
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        details: {
          code: "dts-reload-agent-refused",
          reason: "agent-refused",
          requireHuman: true
        }
      });
      expect(put).not.toHaveBeenCalled();
      expect(createAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          actorType: "agent",
          kind: "dts-reload-agent-refused",
          metadata: expect.objectContaining({
            reason: "agent-refused",
            requireHuman: true
          })
        })
      );
    });

    it("refuses a critical-tier match without elevated capability before asking for confirmation", async () => {
      await seedCandidate({ bindingId: "binding-1" });
      await seedSensitiveRule({ risk_tier: "critical" });
      const { objectStore, put } = makeObjectStore();

      await expect(
        startReloadRun(db, objectStore, auth(), {
          projectId: "project-1",
          targets: [{ bindingId: "binding-1", debugValue: "<7000>" }],
          confirmationToken: "confirm-sensitive-reload"
        })
      ).rejects.toMatchObject({
        details: {
          code: "sensitive-node-reload-denied",
          riskTier: "critical",
          reason: "missing-capability"
        }
      });
      expect(put).not.toHaveBeenCalled();
    });

    it("refuses an agent actor for a critical-tier match even with elevated capability and confirmation", async () => {
      await seedCandidate({ bindingId: "binding-1" });
      await seedSensitiveRule({ risk_tier: "critical" });
      const { objectStore } = makeObjectStore();

      await expect(
        startReloadRun(
          db,
          objectStore,
          elevatedAuth(),
          {
            projectId: "project-1",
            targets: [{ bindingId: "binding-1", debugValue: "<7000>" }],
            confirmationToken: "confirm-sensitive-reload"
          },
          agentContext(elevatedAuth(), "req-dts-agent", db)
        )
      ).rejects.toMatchObject({
        details: {
          code: "dts-reload-agent-refused",
          reason: "agent-refused",
          requireHuman: true
        }
      });
    });

    it("matches compatible-kind rules for reload targets", async () => {
      await seedCandidate({ bindingId: "binding-1", compatible: "vendor,watchdog-v2" });
      await seedSensitiveRule({
        id: "rule-compat",
        match_type: "compatible",
        pattern: "vendor,watchdog*",
        risk_tier: "high"
      });
      const { objectStore } = makeObjectStore();

      await expect(
        startReloadRun(db, objectStore, auth(), {
          projectId: "project-1",
          targets: [{ bindingId: "binding-1", debugValue: "<7000>" }]
        })
      ).rejects.toMatchObject({
        details: {
          code: "sensitive-node-reload-denied",
          matchType: "compatible",
          pattern: "vendor,watchdog*"
        }
      });
    });
  });

  describe("getReloadRun", () => {
    it("reads overlay source back from the object store after refresh", async () => {
      const overlay = '/dts-v1/;\n/plugin/;\n';
      const { objectStore } = makeObjectStore({
        "org-1/overlay.dts": Buffer.from(overlay, "utf8")
      });
      await seedCandidate({ bindingId: "binding-1", nodePath: "/amba/i2c@1/dev@6E" });
      await insertReloadRun(db, {
        id: "run-1",
        organizationId: "org-1",
        projectId: "project-1",
        configRevisionId: null,
        status: "validated",
        failureCode: null,
        steps: [],
        diagnostics: [],
        toolVersions: { dtc: null, fdtoverlay: null },
        overlaySourceStorageKey: "org-1/overlay.dts",
        overlaySourceSha256: "sha",
        overlayArtifactStorageKey: "org-1/overlay.dtbo",
        overlayArtifactSha256: "sha-art",
        overlayArtifactBytes: 8,
        createdByUserId: "user-1",
        completedAt: new Date().toISOString()
      });
      await insertReloadRunTarget(db, {
        id: "target-run-1-0",
        reloadRunId: "run-1",
        bindingId: "binding-1",
        nodePath: "/amba/i2c@1/dev@6E",
        propertyKey: "watchdog_time",
        baselineValue: "<6000>",
        debugValue: "<7000>",
        sortOrder: 0
      });

      const result = await getReloadRun(db, objectStore, auth(), "run-1");
      expect(result.overlaySource).toBe(overlay);
      expect(result.artifact?.sha256).toBe("sha-art");
    });
  });
});

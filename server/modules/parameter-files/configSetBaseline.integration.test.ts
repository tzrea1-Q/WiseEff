import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { parseDts, serializeDts } from "../dts";
import {
  compareBaseline,
  createBaseline,
  releaseBaseline,
  rollbackToBaseline
} from "./baselineService";
import { addConfigSetFile, createConfigSet } from "./configSetService";
import { createStubDtcValidator } from "./dtcValidator";
import { exportConfigSet } from "./exportService";
import { uploadProjectParameterFile } from "./service";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "dts-teaching-sample.dts");
const teachingSample = readFileSync(fixturePath, "utf8");
/** Teaching fixture without /include/ so upload is allowed (P0 decision #4). */
const uploadableSample = teachingSample.replace(/\n\/include\/[^\n]*/g, "\n");

/** Bumps demo_integer/single_value to drive a new file version between snapshots. */
function withSingleValue(source: string, value: string): string {
  const patched = source.replace(/single_value = <\d+>;/, `single_value = <${value}>;`);
  expect(patched).not.toBe(source);
  return patched;
}

function makeAuth(): AuthContext {
  return {
    user: {
      id: "user-csb-int",
      organizationId: "org-csb-int",
      name: "Config Set Baseline Admin",
      email: "csb-int@example.com",
      title: "Admin",
      isActive: true
    },
    organization: { id: "org-csb-int", name: "CSB Org" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"]
  };
}

function createMemoryObjectStore(): ObjectStore {
  const entries = new Map<string, Buffer>();
  return {
    async put(input) {
      const checksum = createHash("sha256").update(input.bytes).digest("hex");
      const storageKey = `${input.organizationId}/${checksum}-${input.fileName}`;
      entries.set(storageKey, Buffer.from(input.bytes));
      return {
        storageKey,
        fileName: input.fileName,
        contentType: input.contentType,
        fileSizeBytes: input.bytes.byteLength,
        checksumSha256: checksum
      };
    },
    async get(storageKey) {
      const value = entries.get(storageKey);
      if (!value) throw new Error(`Missing object: ${storageKey}`);
      return Buffer.from(value);
    }
  };
}

async function seedBaseline(db: InMemoryTestDatabase) {
  await db.query(
    `insert into organizations (id, name) values ('org-csb-int', 'CSB Org')
     on conflict (id) do update set name = excluded.name`
  );
  await db.query(
    `
    insert into users (id, organization_id, name, email, title, is_active)
    values ('user-csb-int', 'org-csb-int', 'Config Set Baseline Admin', 'csb-int@example.com', 'Admin', true)
    on conflict (id) do update set organization_id = excluded.organization_id
    `
  );
  await db.query(
    `
    insert into projects (id, organization_id, name, code, status)
    values ('project-csb-int', 'org-csb-int', 'Config Set Baseline', 'CSB', 'initialized')
    on conflict (id) do update set name = excluded.name
    `
  );
}

/** Always-off stub so export/release tests never depend on a real `dtc` binary being installed. */
function noopValidator() {
  return createStubDtcValidator(() => ({ ok: true, mode: "off", compiler: "unavailable", diagnostics: [] }));
}

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("DTS config set / baseline / gate integration", () => {
  let db: InMemoryTestDatabase | undefined;
  let objectStore: ObjectStore;
  let auth: AuthContext;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedBaseline(db);
    objectStore = createMemoryObjectStore();
    auth = makeAuth();
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("build → baseline → writeback → compare (version_changed + structural diff) → rollback", async () => {
    const boardUpload1 = await uploadProjectParameterFile(db!, objectStore, auth, {
      projectId: "project-csb-int",
      fileName: "board.dts",
      bytes: Buffer.from(uploadableSample, "utf8")
    });
    const overlayUpload = await uploadProjectParameterFile(db!, objectStore, auth, {
      projectId: "project-csb-int",
      fileName: "overlay.dts",
      bytes: Buffer.from(uploadableSample, "utf8")
    });

    const configSet = await createConfigSet(db!, auth, {
      projectId: "project-csb-int",
      name: "main-board"
    });

    await addConfigSetFile(db!, auth, {
      configSetId: configSet.id,
      fileId: boardUpload1.file.id,
      role: "base",
      sortOrder: 0
    });
    await addConfigSetFile(db!, auth, {
      configSetId: configSet.id,
      fileId: overlayUpload.file.id,
      role: "overlay",
      sortOrder: 1
    });

    // 上传/回写产生新版本 (pre-baseline): single_value 42 → 99.
    const boardV2Content = withSingleValue(uploadableSample, "99");
    const boardUpload2 = await uploadProjectParameterFile(db!, objectStore, auth, {
      projectId: "project-csb-int",
      fileName: "board.dts",
      bytes: Buffer.from(boardV2Content, "utf8")
    });
    expect(boardUpload2.version.versionNumber).toBe(2);

    const baseline = await createBaseline(db!, auth, {
      configSetId: configSet.id,
      name: "release-1.0"
    });
    expect(baseline.status).toBe("draft");

    // 再回写 (post-baseline): single_value 99 → 150. Overlay is left untouched.
    const boardV3Content = withSingleValue(boardV2Content, "150");
    const boardUpload3 = await uploadProjectParameterFile(db!, objectStore, auth, {
      projectId: "project-csb-int",
      fileName: "board.dts",
      bytes: Buffer.from(boardV3Content, "utf8")
    });
    expect(boardUpload3.version.versionNumber).toBe(3);

    const comparedAfterDrift = await compareBaseline(db!, auth, baseline.id, { objectStore });
    const boardComparison = comparedAfterDrift.members.find((m) => m.fileId === boardUpload1.file.id);
    const overlayComparison = comparedAfterDrift.members.find((m) => m.fileId === overlayUpload.file.id);

    expect(boardComparison).toMatchObject({
      status: "version_changed",
      baselineVersionId: boardUpload2.version.id,
      currentVersionId: boardUpload3.version.id
    });
    expect(boardComparison?.structuralDiff).toEqual([
      { kind: "prop_changed", nodePath: "demo_integer", prop: "single_value", before: "<99>", after: "<150>" }
    ]);
    expect(overlayComparison).toEqual({
      fileId: overlayUpload.file.id,
      fileName: "overlay.dts",
      status: "unchanged",
      baselineVersionId: overlayUpload.version.id,
      currentVersionId: overlayUpload.version.id
    });

    const rollback = await rollbackToBaseline(db!, auth, baseline.id);
    // Only board drifted after the baseline was taken; overlay never moved.
    expect(rollback).toEqual({ baselineId: baseline.id, restored: 1 });

    const comparedAfterRollback = await compareBaseline(db!, auth, baseline.id, { objectStore });
    // Decision C creates origin='rollback' pointer versions that reuse the pinned blob
    // storageKey. compareBaseline treats same-storageKey pointers as unchanged so the
    // post-rollback workspace matches the baseline snapshot.
    expect(comparedAfterRollback.members.every((m) => m.status === "unchanged")).toBe(true);
    expect(comparedAfterRollback.members).toHaveLength(2);
  });

  it("release gate blocks on dts errors in mode=block, rejects warn/off for release, then passes in block mode", async () => {
    const boardUpload = await uploadProjectParameterFile(db!, objectStore, auth, {
      projectId: "project-csb-int",
      fileName: "board.dts",
      bytes: Buffer.from(uploadableSample, "utf8")
    });

    const configSet = await createConfigSet(db!, auth, {
      projectId: "project-csb-int",
      name: "gate-board"
    });
    await addConfigSetFile(db!, auth, {
      configSetId: configSet.id,
      fileId: boardUpload.file.id,
      role: "base",
      sortOrder: 0
    });

    const baseline = await createBaseline(db!, auth, {
      configSetId: configSet.id,
      name: "release-1.0"
    });

    const blockingValidator = createStubDtcValidator(() => ({
      ok: false,
      mode: "block",
      compiler: "dtc",
      diagnostics: [{ file: "board.dts", line: 12, severity: "error", message: "syntax error" }]
    }));

    await expect(
      releaseBaseline(db!, auth, baseline.id, { objectStore, validator: blockingValidator })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: {
        code: "dts-validation-failed",
        diagnostics: [{ file: "board.dts", line: 12, severity: "error", message: "syntax error" }]
      }
    });

    const warnValidator = createStubDtcValidator(() => ({
      ok: true,
      mode: "warn",
      compiler: "dtc",
      diagnostics: [{ file: "board.dts", line: 12, severity: "error", message: "syntax error" }]
    }));

    vi.stubEnv("DTS_VALIDATION_MODE", "warn");
    await expect(
      releaseBaseline(db!, auth, baseline.id, { objectStore, validator: warnValidator })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: { code: "dts-release-mode-required", mode: "warn" }
    });
    vi.unstubAllEnvs();

    const passValidator = createStubDtcValidator(() => ({
      ok: true,
      mode: "block",
      compiler: "dtc",
      diagnostics: []
    }));

    const released = await releaseBaseline(db!, auth, baseline.id, {
      objectStore,
      validator: passValidator
    });

    expect(released.baseline.status).toBe("released");
    expect(released.gate).toMatchObject({
      ok: true,
      mode: "block",
      requiresConfirmation: false,
      compiler: "dtc"
    });
  });

  it("config set export bundle round-trips dts members losslessly", async () => {
    const boardUpload = await uploadProjectParameterFile(db!, objectStore, auth, {
      projectId: "project-csb-int",
      fileName: "board.dts",
      bytes: Buffer.from(uploadableSample, "utf8")
    });
    const overlayUpload = await uploadProjectParameterFile(db!, objectStore, auth, {
      projectId: "project-csb-int",
      fileName: "overlay.dts",
      bytes: Buffer.from(uploadableSample, "utf8")
    });

    const configSet = await createConfigSet(db!, auth, {
      projectId: "project-csb-int",
      name: "export-board"
    });
    await addConfigSetFile(db!, auth, {
      configSetId: configSet.id,
      fileId: boardUpload.file.id,
      role: "base",
      sortOrder: 0
    });
    await addConfigSetFile(db!, auth, {
      configSetId: configSet.id,
      fileId: overlayUpload.file.id,
      role: "overlay",
      sortOrder: 1
    });

    const result = await exportConfigSet(db!, auth, configSet.id, { objectStore, validator: noopValidator() });

    expect(result.manifest.members).toHaveLength(2);
    expect(result.files).toHaveLength(2);

    const expectedRoundTrip = serializeDts(parseDts(uploadableSample));
    expect(expectedRoundTrip).toBe(uploadableSample);

    const board = result.files.find((f) => f.name === "board.dts");
    const overlay = result.files.find((f) => f.name === "overlay.dts");
    expect(board?.format).toBe("dts");
    expect(overlay?.format).toBe("dts");
    expect(board?.content).toBe(expectedRoundTrip);
    expect(overlay?.content).toBe(expectedRoundTrip);
  });
});

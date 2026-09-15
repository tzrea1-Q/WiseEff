/**
 * Issue #849: deferred project-source formats (YAML / TOML / ENV) are refused with a
 * distinct `UNSUPPORTED_FORMAT` outcome before any staging. These tests assert the
 * refusal happens ahead of the object store write and ahead of any persisted row, so a
 * deferred file can never be silently converted to JSON or skipped as success.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { ApiError } from "../../shared/http/errors";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { createCandidate } from "./candidateService";
import {
  detectDeferredProjectSourceFormat,
  detectFormat,
  uploadProjectParameterFile
} from "./service";

const databaseAvailable = await isTestDatabaseAvailable();

const DEFERRED_FILES = [
  { fileName: "params.yaml", format: "yaml" },
  { fileName: "params.yml", format: "yaml" },
  { fileName: "params.toml", format: "toml" },
  { fileName: "params.env", format: "env" },
  { fileName: ".env", format: "env" }
] as const;

function adminAuth(): AuthContext {
  return makeTestAuthContext({
    userId: "user-1",
    organizationId: "org-1",
    name: "Riley Chen",
    email: "riley@example.com",
    organizationName: "ChargeLab",
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"]
  });
}

/** Memory-backed store that records `put` inputs so pre-staging refusal stays observable. */
function makeObjectStore() {
  const store = createMemoryObjectStore();
  const putCalls: Array<Parameters<ObjectStore["put"]>[0]> = [];
  const objectStore: ObjectStore = {
    put: async (input) => {
      putCalls.push(input);
      return store.put(input);
    },
    get: (storageKey) => store.get(storageKey)
  };
  return { objectStore, putCalls };
}

describe("detectFormat deferred project sources", () => {
  it("keeps accepting json and dts", () => {
    expect(detectFormat("config.json")).toBe("json");
    expect(detectFormat("board.dts")).toBe("dts");
    expect(detectFormat("include.dtsi")).toBe("dts");
  });

  it.each(DEFERRED_FILES)("refuses $fileName as UNSUPPORTED_FORMAT ($format)", ({ fileName, format }) => {
    expect(detectDeferredProjectSourceFormat(fileName)).toBe(format);

    let thrown: unknown;
    try {
      detectFormat(fileName);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    const apiError = thrown as ApiError;
    expect(apiError.code).toBe("UNSUPPORTED_FORMAT");
    expect(apiError.status).toBe(400);
    expect(apiError.details).toMatchObject({
      fileName,
      format,
      deferredTo: "TD-124",
      supportedExtensions: [".json", ".dts", ".dtsi"]
    });
    expect(apiError.message).toMatch(/not supported yet/i);
    expect(apiError.message).toContain(format.toUpperCase());
    expect(apiError.message).toContain("TD-124");
  });

  it("keeps the generic VALIDATION_FAILED for unknown extensions (including .ini)", () => {
    for (const fileName of ["config.txt", "settings.ini", "archive.zip", "noextension"]) {
      expect(detectDeferredProjectSourceFormat(fileName)).toBeNull();
      expect(() => detectFormat(fileName)).toThrow(
        expect.objectContaining({ code: "VALIDATION_FAILED" }) as unknown as ApiError
      );
    }
  });
});

describe.skipIf(!databaseAvailable)("deferred project sources never reach staging", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Riley Chen", email: "riley@example.com" }],
      projects: [{ id: "project-1", name: "Aurora", code: "AUR" }]
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  async function countFiles(): Promise<number> {
    const result = await db.query<{ count: string }>(
      "select count(*)::text as count from project_parameter_files where organization_id = 'org-1'"
    );
    return Number(result.rows[0].count);
  }

  async function countCandidates(): Promise<number> {
    const result = await db.query<{ count: string }>(
      "select count(*)::text as count from project_parameter_file_candidates where organization_id = 'org-1'"
    );
    return Number(result.rows[0].count);
  }

  /** `project_parameter_file_versions` is scoped through its parent file, not by organization. */
  async function countVersionRows(): Promise<number> {
    const result = await db.query<{ count: string }>(
      "select count(*)::text as count from project_parameter_file_versions"
    );
    return Number(result.rows[0].count);
  }

  it.each(DEFERRED_FILES)(
    "upload rejects $fileName before objectStore.put and before any row",
    async ({ fileName, format }) => {
      const { objectStore, putCalls } = makeObjectStore();

      await expect(
        uploadProjectParameterFile(db, objectStore, adminAuth(), {
          projectId: "project-1",
          fileName,
          bytes: Buffer.from("key: value\n", "utf8")
        })
      ).rejects.toMatchObject({
        code: "UNSUPPORTED_FORMAT",
        status: 400,
        details: { fileName, format, deferredTo: "TD-124" }
      });

      expect(putCalls).toHaveLength(0);
      expect(await countFiles()).toBe(0);
      expect(await countVersionRows()).toBe(0);
    }
  );

  it.each(DEFERRED_FILES)(
    "candidate staging rejects $fileName before objectStore.put and before any row",
    async ({ fileName, format }) => {
      const { objectStore, putCalls } = makeObjectStore();

      await expect(
        createCandidate(db, objectStore, adminAuth(), {
          projectId: "project-1",
          fileName,
          bytes: Buffer.from("key = 1\n", "utf8")
        })
      ).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT", details: { fileName, format, deferredTo: "TD-124" } });

      expect(putCalls).toHaveLength(0);
      expect(await countCandidates()).toBe(0);
      expect(await countFiles()).toBe(0);
    }
  );

  it("still stages json and dts uploads", async () => {
    const json = makeObjectStore();
    const uploaded = await uploadProjectParameterFile(db, json.objectStore, adminAuth(), {
      projectId: "project-1",
      fileName: "config.json",
      bytes: Buffer.from('{"battery":{"temp_max":85}}', "utf8")
    });
    expect(uploaded.file.format).toBe("json");
    expect(json.putCalls).toHaveLength(1);

    const dts = makeObjectStore();
    const uploadedDts = await uploadProjectParameterFile(db, dts.objectStore, adminAuth(), {
      projectId: "project-1",
      fileName: "board.dts",
      bytes: Buffer.from("/dts-v1/;\n/ { board_id = <0>; };\n", "utf8")
    });
    expect(uploadedDts.file.format).toBe("dts");
    expect(dts.putCalls).toHaveLength(1);
    expect(await countFiles()).toBe(2);
  });

  it("keeps the generic unknown-extension rejection", async () => {
    const { objectStore, putCalls } = makeObjectStore();

    await expect(
      uploadProjectParameterFile(db, objectStore, adminAuth(), {
        projectId: "project-1",
        fileName: "config.txt",
        bytes: Buffer.from("x", "utf8")
      })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    expect(putCalls).toHaveLength(0);
    expect(await countFiles()).toBe(0);
  });
});

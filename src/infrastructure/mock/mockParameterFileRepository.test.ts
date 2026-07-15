import { describe, expect, it } from "vitest";

import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import { createMockParameterFileRepository } from "./mockParameterFileRepository";

const PROJECT_ID = "project-teaching";

describe("createMockParameterFileRepository (ParameterFileRepository contract)", () => {
  function createRepo(): ParameterFileRepository {
    return createMockParameterFileRepository();
  }

  it("listFiles returns seeded teaching files for a project", async () => {
    const repo = createRepo();
    const files = await repo.listFiles(PROJECT_ID);
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]).toMatchObject({
      projectId: PROJECT_ID,
      fileName: expect.stringMatching(/\.dts$/),
      format: "dts",
      enabled: true
    });
  });

  it("uploadFile appends a file and listVersions returns the new version", async () => {
    const repo = createRepo();
    const before = await repo.listFiles(PROJECT_ID);
    const uploaded = await repo.uploadFile(PROJECT_ID, {
      fileName: "extra.dts",
      contentBase64: Buffer.from("/ { };\n").toString("base64")
    });

    expect(uploaded.item.fileName).toBe("extra.dts");
    expect(uploaded.version.versionNumber).toBe(1);
    expect(uploaded.version.origin).toBe("upload");

    const after = await repo.listFiles(PROJECT_ID);
    expect(after.length).toBe(before.length + 1);

    const versions = await repo.listVersions(PROJECT_ID, uploaded.item.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].id).toBe(uploaded.version.id);
  });

  it("syncFile returns a FileSyncSummary including identityFallbackUses", async () => {
    const repo = createRepo();
    const files = await repo.listFiles(PROJECT_ID);
    const summary = await repo.syncFile(PROJECT_ID, files[0].id);
    expect(summary).toMatchObject({
      draftsCreated: expect.any(Number),
      unchanged: expect.any(Number),
      unmatched: expect.any(Number),
      skipped: false,
      identityFallbackUses: expect.any(Number)
    });
  });

  it("listConflicts and resolveConflict round-trip open conflicts", async () => {
    const repo = createRepo();
    const conflicts = await repo.listConflicts(PROJECT_ID);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0]).toMatchObject({
      projectId: PROJECT_ID,
      status: "open",
      fileValue: expect.any(String),
      uiDraftValue: expect.any(String)
    });

    const resolved = await repo.resolveConflict(PROJECT_ID, conflicts[0].id, "file");
    expect(resolved.status).toBe("resolved_file");

    const remaining = await repo.listConflicts(PROJECT_ID);
    expect(remaining.find((item) => item.id === conflicts[0].id)).toBeUndefined();
  });
});

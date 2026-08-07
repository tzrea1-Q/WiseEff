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

  it("downloadVersion returns the uploaded bytes for a historical version", async () => {
    const repo = createRepo();
    const uploaded = await repo.uploadFile(PROJECT_ID, {
      fileName: "history.dts",
      contentBase64: Buffer.from('/dts-v1/;\n/ { model = "Hist"; };\n').toString("base64")
    });
    const downloaded = await repo.downloadVersion(PROJECT_ID, uploaded.item.id, uploaded.version.id);
    expect(downloaded.fileName).toBe("history.dts");
    expect(new TextDecoder().decode(downloaded.bytes)).toContain('model = "Hist"');
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

  it("createCandidate stages content without changing currentVersionId", async () => {
    const repo = createRepo();
    const before = (await repo.listFiles(PROJECT_ID))[0];
    const candidate = await repo.createCandidate(PROJECT_ID, {
      fileName: before.fileName,
      fileId: before.id,
      contentBase64: btoa("/dts-v1/;\n/ { model = \"Cand\"; };\n")
    });
    expect(candidate.status).toBe("ready");
    const after = (await repo.listFiles(PROJECT_ID)).find((item) => item.id === before.id);
    expect(after?.currentVersionId).toBe(before.currentVersionId);
    const abandoned = await repo.abandonCandidate(PROJECT_ID, candidate.id);
    expect(abandoned.status).toBe("abandoned");
  });

  it("activateCandidate promotes ready candidate and rejects non-ready", async () => {
    const repo = createRepo();
    const before = (await repo.listFiles(PROJECT_ID))[0];
    const candidate = await repo.createCandidate(PROJECT_ID, {
      fileName: before.fileName,
      fileId: before.id,
      contentBase64: btoa("/dts-v1/;\n/ { model = \"Act\"; };\n")
    });
    const activated = await repo.activateCandidate(PROJECT_ID, candidate.id, {
      expectedCurrentVersionId: before.currentVersionId ?? null
    });
    expect(activated.item.status).toBe("active");
    expect(activated.file.currentVersionId).toBe(activated.version.id);
    expect(activated.version.id).not.toBe(before.currentVersionId);

    const blocked = await repo.createCandidate(PROJECT_ID, {
      fileName: before.fileName,
      fileId: before.id,
      contentBase64: btoa("/dts-v1/;\n/ { model = \"Block\"; };\n")
    });
    await repo.abandonCandidate(PROJECT_ID, blocked.id);
    await expect(
      repo.activateCandidate(PROJECT_ID, blocked.id, {
        expectedCurrentVersionId: activated.version.id
      })
    ).rejects.toThrow(/Cannot activate/);
  });
});

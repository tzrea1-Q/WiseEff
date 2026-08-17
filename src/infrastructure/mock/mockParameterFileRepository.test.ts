import { describe, expect, it } from "vitest";

import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
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
    expect(versions[0].createdByDisplayName).toBe("教学用户");
  });

  it("seeded teaching file lists operator display names and can restore a historical version", async () => {
    const repo = createRepo();
    const files = await repo.listFiles(PROJECT_ID);
    const file = files[0]!;
    const versions = await repo.listVersions(PROJECT_ID, file.id);
    expect(versions).toHaveLength(2);
    expect(versions.every((item) => item.createdByDisplayName === "教学用户")).toBe(true);
    const historical = versions.find((item) => item.id !== file.currentVersionId);
    expect(historical).toBeDefined();

    const restored = await repo.rollbackVersion(PROJECT_ID, file.id, historical!.id);
    expect(restored.item.origin).toBe("rollback");
    expect(restored.item.createdByDisplayName).toBe("教学用户");
    expect(restored.file.currentVersionId).toBe(restored.item.id);
    const after = await repo.listVersions(PROJECT_ID, file.id);
    expect(after).toHaveLength(3);
    expect(after.at(-1)?.origin).toBe("rollback");
  });

  it("rollbackVersion inserts a new origin=rollback current version and keeps history", async () => {
    const repo = createRepo();
    const uploaded = await repo.uploadFile(PROJECT_ID, {
      fileName: "history.dts",
      contentBase64: Buffer.from('/dts-v1/;\n/ { model = "V1"; };\n').toString("base64")
    });
    const next = await repo.uploadVersion(PROJECT_ID, uploaded.item.id, {
      fileName: "history.dts",
      contentBase64: Buffer.from('/dts-v1/;\n/ { model = "V2"; };\n').toString("base64")
    });
    expect(next.item.origin).toBe("upload");

    const restored = await repo.rollbackVersion(PROJECT_ID, uploaded.item.id, uploaded.version.id);
    expect(restored.item.origin).toBe("rollback");
    expect(restored.item.versionNumber).toBe(3);
    expect(restored.item.createdByDisplayName).toBe("教学用户");
    expect(restored.file.currentVersionId).toBe(restored.item.id);

    const versions = await repo.listVersions(PROJECT_ID, uploaded.item.id);
    expect(versions).toHaveLength(3);
    expect(versions.map((item) => item.origin)).toEqual(["upload", "upload", "rollback"]);

    const downloaded = await repo.downloadVersion(PROJECT_ID, uploaded.item.id, restored.item.id);
    expect(new TextDecoder().decode(downloaded.bytes)).toContain('model = "V1"');

    await expect(repo.rollbackVersion(PROJECT_ID, uploaded.item.id, restored.item.id)).rejects.toMatchObject({
      code: "CONFLICT"
    });
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
      uiDraftValue: expect.any(String),
      baseValue: expect.any(String),
      fileVersionLabel: expect.stringMatching(/^v\d+$/),
      source: expect.objectContaining({
        startLine: expect.any(Number),
        startColumn: expect.any(Number),
        endLine: expect.any(Number),
        endColumn: expect.any(Number)
      })
    });

    const resolved = await repo.resolveConflict(PROJECT_ID, conflicts[0].id, {
      resolution: "file",
      reason: "prefer file after lab check"
    });
    expect(resolved.status).toBe("resolved_file");

    const remaining = await repo.listConflicts(PROJECT_ID);
    expect(remaining.find((item) => item.id === conflicts[0].id)).toBeUndefined();
  });

  it("previewBulkConflictResolution and resolveConflictsBulk apply only to eligible ids", async () => {
    const repo = createRepo();
    const open = await repo.listConflicts(PROJECT_ID);
    expect(open.length).toBeGreaterThan(0);
    const conflictId = open[0].id;

    const preview = await repo.previewBulkConflictResolution(PROJECT_ID, {
      resolution: "ui",
      conflictIds: [conflictId, "missing-conflict"]
    });
    expect(preview.resolution).toBe("ui");
    expect(preview.eligible.map((item) => item.id)).toEqual([conflictId]);
    expect(preview.ineligible).toEqual([
      expect.objectContaining({ conflict: { id: "missing-conflict" }, reason: "not_found" })
    ]);
    expect(preview.impact).toMatchObject({
      eligibleCount: 1,
      ineligibleCount: 1,
      parameterNames: expect.arrayContaining([expect.any(String)]),
      fileIds: expect.arrayContaining([expect.any(String)])
    });

    const result = await repo.resolveConflictsBulk(PROJECT_ID, {
      resolution: "ui",
      conflictIds: [conflictId, "missing-conflict"],
      reason: "bulk keep UI"
    });
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]).toMatchObject({ id: conflictId, status: "resolved_ui" });
    expect(result.skipped).toEqual([
      expect.objectContaining({ conflict: { id: "missing-conflict" }, reason: "not_found" })
    ]);
    expect(await repo.listConflicts(PROJECT_ID)).toEqual([]);
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

  it("activateCandidate throws CONFLICT when the candidate base is stale", async () => {
    const repo = createRepo();
    const before = (await repo.listFiles(PROJECT_ID))[0];
    const candidate = await repo.createCandidate(PROJECT_ID, {
      fileName: before.fileName,
      fileId: before.id,
      contentBase64: btoa('/dts-v1/;\n/ { model = "Stale"; };\n')
    });

    const error = await repo
      .activateCandidate(PROJECT_ID, candidate.id, {
        expectedCurrentVersionId: "stale-version-id"
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WiseEffApiError);
    expect(error).toMatchObject({
      code: "CONFLICT",
      message: "Candidate base is stale; Working configuration was preserved. Recompute impact before activating.",
      requestId: "mock"
    });
  });

  it("getCandidate throws NOT_FOUND for an unknown candidate id", async () => {
    const repo = createRepo();
    const error = await repo.getCandidate(PROJECT_ID, "missing-candidate").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WiseEffApiError);
    expect(error).toMatchObject({
      code: "NOT_FOUND",
      message: "Candidate not found: missing-candidate",
      requestId: "mock"
    });
  });
});

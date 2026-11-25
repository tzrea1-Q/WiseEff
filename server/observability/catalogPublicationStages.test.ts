import { describe, expect, it } from "vitest";
import { linkCatalogStageToPublication, timeCatalogStage, withCatalogStageLogging } from "./catalogPublicationStages";

describe("catalog publication stage logs", () => {
  it("isolates concurrent requests and claims, including their asynchronous work", async () => {
    const entries: Record<string, string | number>[] = [];
    const log = (entry: Record<string, string | number>) => { entries.push(entry); };
    const job = { jobId: "cjob_48a21828a87d41b5", attempt: 3, fence: 4 };
    const requestId = "aecc13ea-2dad-49b9-80d7-62274bae264e";
    await Promise.all([
      withCatalogStageLogging(job, async () => {
        await Promise.resolve();
        expect(await timeCatalogStage("compile", () => 5)).toBe(5);
      }, log),
      withCatalogStageLogging({ requestId }, async () => {
        await Promise.resolve();
        await expect(timeCatalogStage("markdown-plan", () => { throw new Error("private content"); })).rejects.toThrow();
      }, log),
    ]);
    expect(entries).toEqual(expect.arrayContaining([
      { event: "catalog-stage", stage: "compile", state: "started", ...job },
      { event: "catalog-stage", stage: "compile", state: "finished", elapsedMs: expect.any(Number), ...job },
      { event: "catalog-stage", stage: "markdown-plan", state: "started", requestId },
      { event: "catalog-stage", stage: "markdown-plan", state: "threw", elapsedMs: expect.any(Number), requestId },
    ]));
    expect(entries).toHaveLength(4);
  });

  it("links successful preview and enqueue requests only to server-format record IDs", async () => {
    const entries: Record<string, string | number>[] = [];
    const log = (entry: Record<string, string | number>) => { entries.push(entry); };
    const request = { requestId: "aecc13ea-2dad-49b9-80d7-62274bae264e" };
    const candidateId = "ccand_554cafc9346d4dcc";
    const jobId = "cjob_48a21828a87d41b5";
    for (const [stage, candidate, job] of [
      ["preview", candidateId, undefined], ["enqueue-publication", candidateId, jobId],
      ["preview", "untrusted string", undefined], ["enqueue-publication", candidateId, "untrusted string"],
    ] as const) {
      await withCatalogStageLogging(request, () => timeCatalogStage(stage, () =>
        linkCatalogStageToPublication(candidate, job)), log);
    }
    expect(entries.map(entry => [entry.candidateId, entry.jobId])).toEqual([
      [undefined, undefined], [candidateId, undefined], [undefined, undefined], [candidateId, jobId],
      [undefined, undefined], [undefined, undefined], [undefined, undefined], [candidateId, undefined],
    ]);
  });

  it("hashes custom HTTP request IDs and isolates failures in the log sink", async () => {
    const entries: Record<string, string | number>[] = [];
    const result = await withCatalogStageLogging({ requestId: "secret sent via HTTP" },
      () => timeCatalogStage("preview", async () => ({ ok: false })), entry => {
        entries.push(entry);
        throw new Error("sink unavailable");
      });
    expect(result).toEqual({ ok: false });
    expect(entries.map(entry => entry.requestId)).toEqual([
      expect.stringMatching(/^[a-f0-9]{64}$/), entries[0]!.requestId,
    ]);
    expect(entries.map(entry => entry.state)).toEqual(["started", "finished"]);
  });
});

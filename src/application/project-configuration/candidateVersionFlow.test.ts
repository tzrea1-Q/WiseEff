import { describe, expect, it, vi } from "vitest";

import type {
  ActivateParameterFileCandidateResult,
  ParameterFileCandidate,
  ParameterFileRepository
} from "@/application/ports/ParameterFileRepository";
import { createCandidateVersionFlow } from "./candidateVersionFlow";

function candidate(overrides: Partial<ParameterFileCandidate> = {}): ParameterFileCandidate {
  return {
    id: "cand-1",
    projectId: "proj-1",
    organizationId: "org-1",
    fileId: "file-board",
    fileName: "board.dts",
    format: "dts",
    status: "ready",
    baseVersionId: "ver-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    diagnostics: [],
    impact: { structuralDiff: [{ kind: "prop_changed", nodePath: "board", prop: "model" }] },
    blockers: [],
    ...overrides
  };
}

function encodeFile(name: string, text: string): File {
  return new File([text], name, { type: "text/plain" });
}

describe("createCandidateVersionFlow", () => {
  it("create encodes File to contentBase64 and calls narrow createCandidate Pick", async () => {
    const created = candidate({ status: "ready" });
    const createCandidate = vi.fn(async () => created);
    const repo = { createCandidate } as Pick<ParameterFileRepository, "createCandidate">;
    const flow = createCandidateVersionFlow();

    const result = await flow.create(
      "proj-1",
      { file: encodeFile("board.dts", "/dts-v1/;"), fileId: "file-board" },
      repo
    );

    expect(result.id).toBe("cand-1");
    expect(createCandidate).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({
        fileName: "board.dts",
        fileId: "file-board",
        contentBase64: expect.any(String)
      })
    );
    expect(createCandidate.mock.calls[0][1].contentBase64.length).toBeGreaterThan(0);
    expect(flow.candidate?.id).toBe("cand-1");
    expect(flow.canActivate).toBe(true);
    expect(flow.uploading).toBe(false);
  });

  it("load fetches candidate metadata and source text; clear resets", async () => {
    const item = candidate();
    const getCandidate = vi.fn(async () => item);
    const downloadCandidate = vi.fn(async () => ({
      contentType: "text/plain",
      fileName: "board.dts",
      bytes: new TextEncoder().encode("model = \"x\";")
    }));
    const repo = { getCandidate, downloadCandidate } as Pick<
      ParameterFileRepository,
      "getCandidate" | "downloadCandidate"
    >;
    const flow = createCandidateVersionFlow();

    await flow.load("proj-1", "cand-1", repo);

    expect(flow.candidate?.id).toBe("cand-1");
    expect(flow.sourceText).toContain("model");
    expect(flow.loading).toBe(false);

    flow.clear();
    expect(flow.candidate).toBeNull();
    expect(flow.sourceText).toBe("");
  });

  it("activate uses expectedCurrentVersionId and omits configSet for existing fileId", async () => {
    const item = candidate({ fileId: "file-board", baseVersionId: "ver-1", status: "ready" });
    const activateResult: ActivateParameterFileCandidateResult = {
      item: { ...item, status: "active" },
      file: {
        id: "file-board",
        projectId: "proj-1",
        organizationId: "org-1",
        name: "board.dts",
        format: "dts",
        currentVersionId: "ver-2",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z"
      } as ActivateParameterFileCandidateResult["file"],
      version: {
        id: "ver-2",
        fileId: "file-board",
        versionNumber: 2,
        origin: "upload",
        createdAt: "2026-08-01T00:00:00.000Z"
      } as ActivateParameterFileCandidateResult["version"]
    };
    const activateCandidate = vi.fn(async () => activateResult);
    const flow = createCandidateVersionFlow();
    flow.getSnapshot; // touch
    // seed via create path state
    const createCandidate = vi.fn(async () => item);
    await flow.create("proj-1", { file: encodeFile("board.dts", "x") }, { createCandidate });

    const result = await flow.activate(
      "proj-1",
      {},
      { activateCandidate, getCandidate: vi.fn() }
    );

    expect(activateCandidate).toHaveBeenCalledWith("proj-1", "cand-1", {
      expectedCurrentVersionId: "ver-1",
      configSetId: undefined,
      role: undefined
    });
    expect(result.file.id).toBe("file-board");
  });

  it("activate for new file requires configSetId and sends activateRole", async () => {
    const item = candidate({ fileId: undefined, baseVersionId: null, status: "ready" });
    const activateCandidate = vi.fn(async () => ({
      item,
      file: { id: "file-new" } as never,
      version: { id: "ver-new" } as never
    }));
    const flow = createCandidateVersionFlow();
    await flow.create("proj-1", { file: encodeFile("new.dts", "x") }, {
      createCandidate: vi.fn(async () => item)
    });
    flow.setActivateRole("charging");

    await flow.activate(
      "proj-1",
      { configSetId: "cs-1" },
      { activateCandidate, getCandidate: vi.fn() }
    );

    expect(activateCandidate).toHaveBeenCalledWith("proj-1", "cand-1", {
      expectedCurrentVersionId: null,
      configSetId: "cs-1",
      role: "charging"
    });
  });

  it("stale activate failure refreshes candidate via getCandidate", async () => {
    const item = candidate({ status: "ready" });
    const stale = candidate({ status: "stale" });
    const activateCandidate = vi.fn(async () => {
      throw new Error("Candidate base is stale");
    });
    const getCandidate = vi.fn(async () => stale);
    const flow = createCandidateVersionFlow();
    await flow.create("proj-1", { file: encodeFile("board.dts", "x") }, {
      createCandidate: vi.fn(async () => item)
    });

    await expect(
      flow.activate("proj-1", {}, { activateCandidate, getCandidate })
    ).rejects.toThrow(/stale/i);

    expect(getCandidate).toHaveBeenCalledWith("proj-1", "cand-1");
    expect(flow.candidate?.status).toBe("stale");
    expect(flow.canRecompute).toBe(true);
  });

  it("recompute and abandon update candidate and gates", async () => {
    const ready = candidate({ status: "blocked" });
    const flow = createCandidateVersionFlow();
    await flow.create("proj-1", { file: encodeFile("board.dts", "x") }, {
      createCandidate: vi.fn(async () => ready)
    });
    expect(flow.canRecompute).toBe(true);

    const recomputed = candidate({ status: "ready" });
    await flow.recompute("proj-1", {
      recomputeCandidate: vi.fn(async () => recomputed)
    });
    expect(flow.canActivate).toBe(true);

    const abandoned = candidate({ status: "abandoned" });
    await flow.abandon("proj-1", {
      abandonCandidate: vi.fn(async () => abandoned)
    });
    expect(flow.canAbandon).toBe(false);
    expect(flow.candidate?.status).toBe("abandoned");
  });
});

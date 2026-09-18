import { describe, expect, it, vi } from "vitest";

import { createCanonicalDraftTraySource } from "./canonicalDraftTraySource";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });

describe("canonical draft tray source", () => {
  it("reads the canonical pending-draft list and maps it onto the tray shape", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      calls.push({ method: init?.method ?? "GET", url: String(input) });
      return json({
        items: [
          {
            id: "pvd_01K",
            bindingId: "pbind_01K",
            definitionId: "pdef_01K",
            effectiveRevisionId: "drev_01K",
            baseRevisionId: "config-revision-01K",
            currentValueId: "pval_01K",
            targetValue: "2000",
            reason: "raise published input current",
            updatedAt: "2026-09-15T00:00:00.000Z"
          }
        ]
      });
    });
    const source = createCanonicalDraftTraySource({
      listProjectValueDrafts: (projectId: string) =>
        fetchMock(`/api/v2/projects/${projectId}/parameter-value-drafts`, { method: "GET" }).then(
          (response) => response.json() as Promise<never>
        ),
      deleteProjectValueDraft: (projectId: string, draftId: string) =>
        fetchMock(
          `/api/v2/projects/${projectId}/parameter-value-drafts/${encodeURIComponent(draftId)}`,
          { method: "DELETE" }
        ).then(() => undefined)
    } as never);

    const drafts = await source.listDrafts("atlas");
    expect(drafts).toEqual([
      {
        id: "pvd_01K",
        projectId: "atlas",
        targetValue: "2000",
        reason: "raise published input current",
        updatedAt: "2026-09-15T00:00:00.000Z",
        action: "set",
        projectParameterBindingId: "pbind_01K",
        candidateConfigRevisionId: "config-revision-01K",
        baseRevisionId: "config-revision-01K"
      }
    ]);
    expect(drafts[0]).not.toHaveProperty("parameterId");

    await source.deleteDraft("atlas", "pvd_01K");
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET /api/v2/projects/atlas/parameter-value-drafts",
      "DELETE /api/v2/projects/atlas/parameter-value-drafts/pvd_01K"
    ]);
    // No legacy draft endpoint is touched in either direction.
    expect(calls.some((call) => call.url.includes("/api/v1/parameter-drafts"))).toBe(false);
  });

  it("preserves the canonical JSON source target for tray reload", async () => {
    const source = createCanonicalDraftTraySource({
      listProjectValueDrafts: async () => ({
        items: [{
          id: "pvd-json-01K",
          bindingId: "pbind-json-01K",
          definitionId: "pdef-json-01K",
          effectiveRevisionId: "drev-json-01K",
          currentValueId: null,
          targetValue: "legacy projection must not win",
          sourceFormat: "json",
          sourceTarget: { format: "json", sourceText: '{"enabled":true}\n' },
          sourcePinId: "spin-json-01K",
          candidateId: "cand-json-01K",
          baseRevisionId: "base-json-01K",
          reason: "preserve JSON source",
          updatedAt: "2026-09-15T00:00:00.000Z"
        }]
      }),
      deleteProjectValueDraft: async () => ({ item: { id: "pvd-json-01K" } })
    } as never);

    await expect(source.listDrafts("atlas")).resolves.toEqual([
      expect.objectContaining({
        id: "pvd-json-01K",
        sourceFormat: "json",
        sourceTarget: { format: "json", sourceText: '{"enabled":true}\n' },
        targetValue: "legacy projection must not win"
      })
    ]);
  });
});

import { describe, expect, it, vi } from "vitest";

import { createApiClient, WiseEffApiError } from "./apiClient";
import { requestXiaozeSuggestions } from "./xiaozeSuggestionsClient";

describe("requestXiaozeSuggestions", () => {
  it("posts page context with API authorization and returns a parsed typed response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          suggestions: [
            {
              id: "suggest-1",
              tone: "warning",
              headline: "有 3 条参数变更待审阅",
              meta: "项目：Demo 项目",
              citations: []
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    const apiClient = createApiClient({
      baseUrl: "http://127.0.0.1:8787",
      authorization: "Bearer test-token",
      fetchImpl
    });

    await expect(
      requestXiaozeSuggestions(
        {
          path: "/parameters",
          pageKey: "parameters",
          projectId: "project-1",
          projectName: "Demo 项目"
        },
        apiClient
      )
    ).resolves.toEqual([
      {
        id: "suggest-1",
        tone: "warning",
        headline: "有 3 条参数变更待审阅",
        meta: "项目：Demo 项目",
        citations: []
      }
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/v1/agent/xiaoze/suggest",
      expect.objectContaining({
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: "Bearer test-token"
        },
        body: JSON.stringify({
          context: {
            path: "/parameters",
            pageKey: "parameters",
            projectId: "project-1",
            projectName: "Demo 项目"
          }
        })
      })
    );
  });

  it("surfaces structured HTTP failures from the API client", async () => {
    const apiClient = createApiClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "FORBIDDEN",
              message: "Suggestions are disabled.",
              details: { flag: "XIAOZE_PROACTIVE_ENABLED" },
              requestId: "req-1"
            }
          }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        )
      )
    });

    await expect(requestXiaozeSuggestions({ projectId: "project-1" }, apiClient)).rejects.toMatchObject({
      code: "FORBIDDEN",
      requestId: "req-1"
    });
  });

  it("rejects contract drift instead of returning malformed suggestions", async () => {
    const apiClient = createApiClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ suggestions: [{ id: "suggest-1", tone: "alarm" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    });

    await expect(requestXiaozeSuggestions({ projectId: "project-1" }, apiClient)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof WiseEffApiError &&
        error.details.reason === "contract-drift" &&
        error.details.schemaName === "XiaozeSuggestResponse"
    );
  });
});

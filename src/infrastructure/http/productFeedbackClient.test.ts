import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiClient, WiseEffApiError } from "./apiClient";
import { createHttpProductFeedbackRepository } from "./productFeedbackClient";
import type { ProductFeedbackDto } from "./productFeedbackClient";

const baseFeedbackDto: ProductFeedbackDto = {
  id: "feedback-1",
  organizationId: "org-1",
  submitterUserId: "user-1",
  pagePath: "/logs",
  pageTitle: "日志分析",
  feedbackType: "experience",
  description: "上传入口不够明显。",
  status: "open",
  adminNote: null,
  createdAt: "2026-07-08T08:00:00.000Z",
  updatedAt: "2026-07-08T08:00:00.000Z",
  attachments: [
    {
      id: "attachment-1",
      feedbackId: "feedback-1",
      organizationId: "org-1",
      storageKey: "product-feedback/org-1/attachment-1",
      fileName: "screen.png",
      contentType: "image/png",
      sizeBytes: 3,
      checksum: "sha256",
      sortOrder: 0,
      createdAt: "2026-07-08T08:00:00.000Z"
    }
  ]
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function createFetchMock(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => jsonResponse(body, status));
}

function createRepository(fetchMock: typeof fetch) {
  return createHttpProductFeedbackRepository({
    apiClient: createApiClient({ baseUrl: "http://127.0.0.1:8787", authorization: "Bearer test-token", fetchImpl: fetchMock }),
    baseUrl: "http://127.0.0.1:8787",
    fetchImpl: fetchMock
  });
}

describe("createHttpProductFeedbackRepository", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits feedback with base64 encoded attachments", async () => {
    const fetchMock = createFetchMock({ item: baseFeedbackDto }, 201);
    const repository = createRepository(fetchMock);
    const file = new File(["png"], "screen.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new TextEncoder().encode("png").buffer
    });

    await expect(
      repository.submit({
        pagePath: "/logs",
        pageTitle: "日志分析",
        feedbackType: "experience",
        description: "上传入口不够明显。",
        files: [file]
      })
    ).resolves.toMatchObject({ id: "feedback-1", attachments: [{ id: "attachment-1" }] });

    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/api/v1/product-feedback");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer test-token" }
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      pagePath: "/logs",
      pageTitle: "日志分析",
      feedbackType: "experience",
      description: "上传入口不够明显。",
      attachments: [
        {
          fileName: "screen.png",
          contentType: "image/png",
          contentBase64: btoa("png")
        }
      ]
    });
  });

  it("lists feedback with encoded filters and cursor", async () => {
    const fetchMock = createFetchMock({ items: [baseFeedbackDto], nextCursor: "cursor-2" });
    const repository = createRepository(fetchMock);

    await expect(
      repository.list({
        status: "open",
        feedbackType: "data",
        q: "电压",
        pagePath: "/parameters",
        createdFrom: "2026-07-01T00:00:00.000Z",
        createdTo: "2026-07-08T00:00:00.000Z",
        cursor: "cursor-1"
      })
    ).resolves.toMatchObject({ items: [{ id: "feedback-1" }], nextCursor: "cursor-2" });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://127.0.0.1:8787/api/v1/product-feedback?status=open&feedbackType=data&q=%E7%94%B5%E5%8E%8B&pagePath=%2Fparameters&createdFrom=2026-07-01T00%3A00%3A00.000Z&createdTo=2026-07-08T00%3A00%3A00.000Z&cursor=cursor-1"
    );
  });

  it("gets feedback and maps not found to null", async () => {
    const foundFetch = createFetchMock({ item: baseFeedbackDto });
    await expect(createRepository(foundFetch).get("feedback-1")).resolves.toMatchObject({ id: "feedback-1" });
    expect(foundFetch.mock.calls[0][0]).toBe("http://127.0.0.1:8787/api/v1/product-feedback/feedback-1");

    const missingFetch = createFetchMock(
      {
        error: {
          code: "NOT_FOUND",
          message: "Product feedback was not found.",
          details: { feedbackId: "missing" },
          requestId: "req-1"
        }
      },
      404
    );
    await expect(createRepository(missingFetch).get("missing")).resolves.toBeNull();
  });

  it("patches feedback status and admin note", async () => {
    const fetchMock = createFetchMock({ item: { ...baseFeedbackDto, status: "in_progress", adminNote: "已排查" } });
    const repository = createRepository(fetchMock);

    await expect(repository.update("feedback-1", { status: "in_progress", adminNote: "已排查" })).resolves.toMatchObject({
      status: "in_progress",
      adminNote: "已排查"
    });

    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/api/v1/product-feedback/feedback-1");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ status: "in_progress", adminNote: "已排查" });
  });

  it("fetches attachment content as an object URL with auth headers", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(new Blob(["png"], { type: "image/png" }), { status: 200 }));
    const createObjectURL = vi.fn(() => "blob:http://localhost/preview");
    vi.stubGlobal("URL", { ...URL, createObjectURL });
    const repository = createRepository(fetchMock);

    await expect(repository.getAttachmentObjectUrl("feedback-1", "attachment-1")).resolves.toBe("blob:http://localhost/preview");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://127.0.0.1:8787/api/v1/product-feedback/feedback-1/attachments/attachment-1/content"
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "GET",
      headers: { Accept: "image/*", Authorization: "Bearer test-token" }
    });
    expect(createObjectURL.mock.calls[0][0]).toMatchObject({ size: expect.any(Number), type: expect.any(String) });
  });

  it("rethrows API errors from list", async () => {
    const fetchMock = createFetchMock(
      {
        error: {
          code: "FORBIDDEN",
          message: "Forbidden.",
          details: { permission: "product-feedback:admin" },
          requestId: "req-1"
        }
      },
      403
    );

    await expect(createRepository(fetchMock).list()).rejects.toBeInstanceOf(WiseEffApiError);
  });
});

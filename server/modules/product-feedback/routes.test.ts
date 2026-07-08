import type { Server } from "node:http";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerProductFeedbackRoutes } from "./routes";
import * as service from "./service";
import type { ProductFeedbackDto } from "./types";

vi.mock("./service", () => ({
  createProductFeedback: vi.fn(),
  getProductFeedback: vi.fn(),
  getProductFeedbackAttachmentContent: vi.fn(),
  listProductFeedback: vi.fn(),
  updateProductFeedback: vi.fn()
}));

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Software User",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: "aurora", roleId: "software-user" }],
    permissions: ["admin:access"],
    ...overrides
  };
}

function makeDb(): Database {
  return {
    query: vi.fn(),
    transaction: vi.fn()
  };
}

function makeObjectStore(): ObjectStore {
  return {
    put: vi.fn(),
    get: vi.fn()
  };
}

function feedbackRecord(overrides: Partial<ProductFeedbackDto> = {}): ProductFeedbackDto {
  return {
    id: "feedback-1",
    organizationId: "org-1",
    submitterUserId: "user-1",
    pagePath: "/parameters",
    pageTitle: "Project Parameters",
    feedbackType: "experience",
    description: "The buttons are hard to scan.",
    status: "open",
    adminNote: null,
    createdAt: "2026-07-08T08:00:00.000Z",
    updatedAt: "2026-07-08T08:00:00.000Z",
    attachments: [],
    ...overrides
  };
}

function attachmentRecord(overrides: Partial<ProductFeedbackDto["attachments"][number]> = {}): ProductFeedbackDto["attachments"][number] {
  return {
    id: "attachment-1",
    feedbackId: "feedback-1",
    organizationId: "org-1",
    storageKey: "org-1/product-feedback/attachment-1.png",
    fileName: "screenshot.png",
    contentType: "image/png",
    sizeBytes: 16,
    checksum: "checksum",
    sortOrder: 0,
    createdAt: "2026-07-08T08:00:00.000Z",
    ...overrides
  };
}

function makeServer(options: { db?: Database; objectStore?: ObjectStore; auth?: AuthContext } = {}) {
  const router = createRouter();
  registerProductFeedbackRoutes(router, {
    db: options.db,
    objectStore: options.objectStore,
    getCurrentAuthContext: () => options.auth ?? makeAuth()
  });
  return createHttpServer(router);
}

async function requestBytes(server: Server, path: string, init: RequestInit = {}) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      ...init,
      headers: {
        "X-Request-Id": "test-request",
        ...(init.headers ?? {})
      }
    });
    return {
      status: response.status,
      bytes: Buffer.from(await response.arrayBuffer()),
      headers: response.headers
    };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("product feedback routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST /api/v1/product-feedback validates body and delegates to create service", async () => {
    const db = makeDb();
    const objectStore = makeObjectStore();
    const item = feedbackRecord({ id: "feedback-created" });
    vi.mocked(service.createProductFeedback).mockResolvedValue(item);

    const response = await requestJson<{ item: typeof item }>(makeServer({ db, objectStore }), "/api/v1/product-feedback", {
      method: "POST",
      body: JSON.stringify({
        pagePath: "/parameters",
        pageTitle: "Project Parameters",
        feedbackType: "experience",
        description: "The buttons are hard to scan.",
        attachments: [
          {
            fileName: "screenshot.png",
            contentType: "image/png",
            contentBase64: Buffer.from("image-bytes").toString("base64")
          }
        ]
      })
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ item });
    expect(service.createProductFeedback).toHaveBeenCalledWith(
      db,
      objectStore,
      makeAuth(),
      {
        pagePath: "/parameters",
        pageTitle: "Project Parameters",
        feedbackType: "experience",
        description: "The buttons are hard to scan.",
        attachments: [
          {
            fileName: "screenshot.png",
            contentType: "image/png",
            contentBase64: Buffer.from("image-bytes").toString("base64")
          }
        ]
      },
      { requestId: "test-request" }
    );
  });

  it("POST /api/v1/product-feedback rejects invalid create body before service", async () => {
    const response = await requestJson<{ error: { code: string; details: { issues?: unknown[] } } }>(
      makeServer({ db: makeDb(), objectStore: makeObjectStore() }),
      "/api/v1/product-feedback",
      {
        method: "POST",
        body: JSON.stringify({ pagePath: "/parameters" })
      }
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details.issues).toEqual(expect.any(Array));
    expect(service.createProductFeedback).not.toHaveBeenCalled();
  });

  it("GET /api/v1/product-feedback parses filters and returns paginated items", async () => {
    const db = makeDb();
    const item = feedbackRecord({ id: "feedback-list" });
    const nextCursor = { createdAt: "2026-07-08T08:00:00.000Z", id: "feedback-list" };
    const cursor = Buffer.from(JSON.stringify({ createdAt: "2026-07-07T08:00:00.000Z", id: "feedback-cursor" }), "utf8").toString(
      "base64url"
    );
    vi.mocked(service.listProductFeedback).mockResolvedValue({ items: [item], nextCursor });

    const response = await requestJson<{ items: typeof item[]; nextCursor: typeof nextCursor }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      `/api/v1/product-feedback?status=open&feedbackType=experience&q=buttons&pagePath=%2Fparameters&createdFrom=2026-07-01T00%3A00%3A00.000Z&createdTo=2026-07-08T00%3A00%3A00.000Z&cursor=${cursor}&limit=25`
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [item], nextCursor });
    expect(service.listProductFeedback).toHaveBeenCalledWith(db, makeAuth(), {
      status: "open",
      feedbackType: "experience",
      q: "buttons",
      pagePath: "/parameters",
      createdFrom: "2026-07-01T00:00:00.000Z",
      createdTo: "2026-07-08T00:00:00.000Z",
      cursor: { createdAt: "2026-07-07T08:00:00.000Z", id: "feedback-cursor" },
      limit: 25
    });
  });

  it("GET /api/v1/product-feedback/:id uses route params", async () => {
    const db = makeDb();
    const item = feedbackRecord({ id: "feedback-route" });
    vi.mocked(service.getProductFeedback).mockResolvedValue(item);

    const response = await requestJson<{ item: typeof item }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      "/api/v1/product-feedback/feedback-route"
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ item });
    expect(service.getProductFeedback).toHaveBeenCalledWith(db, makeAuth(), "feedback-route");
  });

  it("PATCH /api/v1/product-feedback/:id validates patch body and delegates to update service", async () => {
    const db = makeDb();
    const item = feedbackRecord({ id: "feedback-route", status: "in_progress", adminNote: "Triaged by admin." });
    vi.mocked(service.updateProductFeedback).mockResolvedValue(item);

    const response = await requestJson<{ item: typeof item }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      "/api/v1/product-feedback/feedback-route",
      {
        method: "PATCH",
        body: JSON.stringify({ status: "in_progress", adminNote: "Triaged by admin." })
      }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ item });
    expect(service.updateProductFeedback).toHaveBeenCalledWith(
      db,
      makeAuth(),
      "feedback-route",
      { status: "in_progress", adminNote: "Triaged by admin." },
      { requestId: "test-request" }
    );
  });

  it("PATCH /api/v1/product-feedback/:id rejects empty patch body before service", async () => {
    const response = await requestJson<{ error: { code: string; details: { issues?: unknown[] } } }>(
      makeServer({ db: makeDb(), objectStore: makeObjectStore() }),
      "/api/v1/product-feedback/feedback-route",
      { method: "PATCH", body: JSON.stringify({}) }
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details.issues).toEqual(expect.any(Array));
    expect(service.updateProductFeedback).not.toHaveBeenCalled();
  });

  it("GET /api/v1/product-feedback/:id/attachments/:attachmentId/content returns bytes with content type", async () => {
    const db = makeDb();
    const objectStore = makeObjectStore();
    const attachment = attachmentRecord({ id: "attachment-route", contentType: "image/webp", fileName: "shot.webp" });
    const bytes = Buffer.from("image-content");
    vi.mocked(service.getProductFeedbackAttachmentContent).mockResolvedValue({ attachment, bytes });

    const response = await requestBytes(
      makeServer({ db, objectStore }),
      "/api/v1/product-feedback/feedback-route/attachments/attachment-route/content"
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.bytes).toEqual(bytes);
    expect(service.getProductFeedbackAttachmentContent).toHaveBeenCalledWith(db, objectStore, makeAuth(), "feedback-route", "attachment-route");
  });

  it("GET attachment content maps missing content to 404", async () => {
    const db = makeDb();
    const objectStore = makeObjectStore();
    vi.mocked(service.getProductFeedbackAttachmentContent).mockRejectedValue(
      new ApiError("NOT_FOUND", "Product feedback was not found.", 404, { feedbackId: "feedback-route" })
    );

    const response = await requestJson<{ error: { code: string } }>(
      makeServer({ db, objectStore }),
      "/api/v1/product-feedback/feedback-route/attachments/missing/content"
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });
});

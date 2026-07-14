import { describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/mock/mockDtsStructuredRepository", () => ({
  createMockDtsStructuredRepository: vi.fn(() => ({ kind: "mock-repo" }))
}));

vi.mock("@/infrastructure/http/dtsStructuredClient", () => ({
  createDtsStructuredClient: vi.fn(() => ({ kind: "http-repo" }))
}));

import { createDtsStructuredClient } from "@/infrastructure/http/dtsStructuredClient";
import { createMockDtsStructuredRepository } from "@/infrastructure/mock/mockDtsStructuredRepository";
import { resolveDtsStructuredRepository } from "./dtsStructuredRuntime";

describe("resolveDtsStructuredRepository", () => {
  it("returns mock repository when runtimeMode is mock", () => {
    const repo = resolveDtsStructuredRepository("mock");
    expect(createMockDtsStructuredRepository).toHaveBeenCalled();
    expect(createDtsStructuredClient).not.toHaveBeenCalled();
    expect(repo).toEqual({ kind: "mock-repo" });
  });

  it("returns http client when runtimeMode is api", () => {
    vi.mocked(createMockDtsStructuredRepository).mockClear();
    vi.mocked(createDtsStructuredClient).mockClear();

    const repo = resolveDtsStructuredRepository("api");
    expect(createDtsStructuredClient).toHaveBeenCalled();
    expect(createMockDtsStructuredRepository).not.toHaveBeenCalled();
    expect(repo).toEqual({ kind: "http-repo" });
  });
});

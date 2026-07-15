import { describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/mock/mockParameterFileRepository", () => ({
  createMockParameterFileRepository: vi.fn(() => ({ kind: "mock-repo" }))
}));

vi.mock("@/infrastructure/http/parameterFileClient", () => ({
  createParameterFileClient: vi.fn(() => ({ kind: "http-repo" }))
}));

import { createParameterFileClient } from "@/infrastructure/http/parameterFileClient";
import { createMockParameterFileRepository } from "@/infrastructure/mock/mockParameterFileRepository";
import { resolveParameterFileRepository } from "./parameterFileRuntime";

describe("resolveParameterFileRepository", () => {
  it("returns mock repository when runtimeMode is mock", () => {
    const repo = resolveParameterFileRepository("mock");
    expect(createMockParameterFileRepository).toHaveBeenCalled();
    expect(createParameterFileClient).not.toHaveBeenCalled();
    expect(repo).toEqual({ kind: "mock-repo" });
  });

  it("returns http client when runtimeMode is api", () => {
    vi.mocked(createMockParameterFileRepository).mockClear();
    vi.mocked(createParameterFileClient).mockClear();

    const repo = resolveParameterFileRepository("api");
    expect(createParameterFileClient).toHaveBeenCalled();
    expect(createMockParameterFileRepository).not.toHaveBeenCalled();
    expect(repo).toEqual({ kind: "http-repo" });
  });
});

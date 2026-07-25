import { describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/mock/mockParameterTopologyRepository", () => ({
  createMockParameterTopologyRepository: vi.fn(() => ({ kind: "mock-repo" }))
}));

vi.mock("@/infrastructure/http/parameterTopologyClient", () => ({
  createHttpParameterTopologyRepository: vi.fn(() => ({ kind: "http-repo" }))
}));

import { createHttpParameterTopologyRepository } from "@/infrastructure/http/parameterTopologyClient";
import { createMockParameterTopologyRepository } from "@/infrastructure/mock/mockParameterTopologyRepository";
import { resolveParameterTopologyRepository } from "./parameterTopologyResolve";

describe("resolveParameterTopologyRepository", () => {
  it("returns mock repository when runtimeMode is mock", () => {
    const repo = resolveParameterTopologyRepository("mock");
    expect(createMockParameterTopologyRepository).toHaveBeenCalled();
    expect(createHttpParameterTopologyRepository).not.toHaveBeenCalled();
    expect(repo).toEqual({ kind: "mock-repo" });
  });

  it("returns http client when runtimeMode is api", () => {
    vi.mocked(createMockParameterTopologyRepository).mockClear();
    vi.mocked(createHttpParameterTopologyRepository).mockClear();

    const repo = resolveParameterTopologyRepository("api");
    expect(createHttpParameterTopologyRepository).toHaveBeenCalled();
    expect(createMockParameterTopologyRepository).not.toHaveBeenCalled();
    expect(repo).toEqual({ kind: "http-repo" });
  });
});

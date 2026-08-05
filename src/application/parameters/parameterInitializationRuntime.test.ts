import { describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/mock/mockParameterInitializationRepository", () => ({
  createMockParameterInitializationRepository: vi.fn(() => ({ kind: "mock-init-repo" }))
}));

vi.mock("@/infrastructure/http/parameterInitializationClient", () => ({
  createHttpParameterInitializationRepository: vi.fn(() => ({ kind: "http-init-repo" }))
}));

import { createHttpParameterInitializationRepository } from "@/infrastructure/http/parameterInitializationClient";
import { createMockParameterInitializationRepository } from "@/infrastructure/mock/mockParameterInitializationRepository";
import { resolveParameterInitializationRepository } from "./parameterInitializationRuntime";

describe("resolveParameterInitializationRepository", () => {
  it("returns mock repository in mock mode", () => {
    const repo = resolveParameterInitializationRepository("mock");
    expect(repo).toEqual({ kind: "mock-init-repo" });
    expect(createHttpParameterInitializationRepository).not.toHaveBeenCalled();
  });

  it("returns http repository in api mode", () => {
    vi.mocked(createMockParameterInitializationRepository).mockClear();
    vi.mocked(createHttpParameterInitializationRepository).mockClear();

    const repo = resolveParameterInitializationRepository("api");
    expect(repo).toEqual({ kind: "http-init-repo" });
    expect(createHttpParameterInitializationRepository).toHaveBeenCalled();
  });
});

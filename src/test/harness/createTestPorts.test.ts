import { describe, expect, it, vi } from "vitest";

import {
  createTestDebuggingRuntimeActions,
  createTestDtsStructuredRepository,
  createTestLogRuntimeActions,
  createTestParameterFileRepository
} from "./index";

describe("createTestDtsStructuredRepository", () => {
  it("wraps a fresh production mock adapter with observable methods", async () => {
    const first = createTestDtsStructuredRepository();
    const second = createTestDtsStructuredRepository();

    await first.createConfigSet("project-fresh", { name: "isolated" });

    expect((await first.listConfigSets("project-fresh")).map((item) => item.name)).toContain("isolated");
    expect((await second.listConfigSets("project-fresh")).map((item) => item.name)).not.toContain("isolated");
    expect(first.createConfigSet).toHaveBeenCalledWith("project-fresh", { name: "isolated" });
    expect(first.listConfigSets).toHaveBeenCalled();
  });

  it("lets a method override win over the production mock adapter", async () => {
    const listConfigSets = vi.fn().mockResolvedValue([
      {
        id: "config-set-override",
        organizationId: "org-override",
        projectId: "project-override",
        name: "override",
        createdAt: "2026-08-22T00:00:00.000Z",
        updatedAt: "2026-08-22T00:00:00.000Z"
      }
    ]);
    const repository = createTestDtsStructuredRepository({ listConfigSets });

    await expect(repository.listConfigSets("project-override")).resolves.toEqual([
      expect.objectContaining({ id: "config-set-override", name: "override" })
    ]);
    expect(listConfigSets).toHaveBeenCalledWith("project-override");
  });
});

describe("createTestParameterFileRepository", () => {
  it("wraps a fresh production mock adapter with observable methods", async () => {
    const first = createTestParameterFileRepository();
    const second = createTestParameterFileRepository();

    await first.uploadFile("project-fresh", {
      fileName: "isolated.dts",
      contentBase64: btoa("/dts-v1/;\n/ {};\n")
    });

    expect((await first.listFiles("project-fresh")).map((item) => item.fileName)).toContain("isolated.dts");
    expect((await second.listFiles("project-fresh")).map((item) => item.fileName)).not.toContain("isolated.dts");
    expect(first.uploadFile).toHaveBeenCalled();
    expect(first.listFiles).toHaveBeenCalled();
  });

  it("lets a method override win over the production mock adapter", async () => {
    const listFiles = vi.fn().mockResolvedValue([]);
    const repository = createTestParameterFileRepository({ listFiles });

    await expect(repository.listFiles("project-override")).resolves.toEqual([]);
    expect(listFiles).toHaveBeenCalledWith("project-override");
  });
});

describe("test runtime action factories", () => {
  it("returns observable log actions and lets overrides win", async () => {
    const rerun = vi.fn().mockRejectedValue(new Error("rerun sentinel"));
    const first = createTestLogRuntimeActions({ rerun });
    const second = createTestLogRuntimeActions();

    await expect(first.refresh()).resolves.toBeUndefined();
    await expect(first.rerun({ logId: "log-1" })).rejects.toThrow("rerun sentinel");
    expect(first.refresh).toHaveBeenCalledTimes(1);
    expect(second.refresh).not.toHaveBeenCalled();
    expect(rerun).toHaveBeenCalledWith({ logId: "log-1" });
  });

  it("returns observable debugging actions and lets overrides win", async () => {
    const pushValues = vi.fn().mockRejectedValue(new Error("push sentinel"));
    const first = createTestDebuggingRuntimeActions({ pushValues });
    const second = createTestDebuggingRuntimeActions();

    await expect(first.refresh()).resolves.toBeUndefined();
    await expect(first.pushValues(["parameter-1"])).rejects.toThrow("push sentinel");
    expect(first.refresh).toHaveBeenCalledTimes(1);
    expect(second.refresh).not.toHaveBeenCalled();
    expect(pushValues).toHaveBeenCalledWith(["parameter-1"]);
  });
});

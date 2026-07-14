import { describe, expect, it, vi } from "vitest";

import { createDtsStructuredClient } from "./dtsStructuredClient";

describe("createDtsStructuredClient", () => {
  it("maps structure and search endpoints with path encoding", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ nodes: [] })
      .mockResolvedValueOnce({ items: [] });
    const client = createDtsStructuredClient({ get } as never);

    await client.getStructure("project/1", "file/with spaces", "version/1");
    await client.search("project/1", { q: "chip@6E", by: "path" });

    expect(get).toHaveBeenNthCalledWith(
      1,
      "/api/v1/projects/project%2F1/parameter-files/file%2Fwith%20spaces/versions/version%2F1/structure"
    );
    expect(get).toHaveBeenNthCalledWith(
      2,
      "/api/v1/projects/project%2F1/dts-search?q=chip%406E&by=path"
    );
  });

  it("maps config-set CRUD and export, unwrapping envelopes", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ id: "cs-1" }] })
      .mockResolvedValueOnce({
        manifest: { configSetId: "cs-1", name: "default", projectId: "project/1", exportedAt: "t", members: [] },
        files: []
      });
    const post = vi
      .fn()
      .mockResolvedValueOnce({ item: { id: "cs-new", name: "board-a" } })
      .mockResolvedValueOnce({ item: { configSetId: "cs-new", fileId: "file/1", role: "base", sortOrder: 0 } });
    const del = vi.fn().mockResolvedValueOnce({});
    const client = createDtsStructuredClient({ get, post, delete: del } as never);

    const listed = await client.listConfigSets("project/1");
    expect(listed).toEqual([{ id: "cs-1" }]);

    const created = await client.createConfigSet("project/1", { name: "board-a" });
    expect(created).toEqual({ id: "cs-new", name: "board-a" });

    const membership = await client.addConfigSetFile("project/1", "cs/new", {
      fileId: "file/1",
      role: "base"
    });
    expect(membership).toEqual({ configSetId: "cs-new", fileId: "file/1", role: "base", sortOrder: 0 });

    await client.removeConfigSetFile("project/1", "cs/new", "file/1");
    const exported = await client.exportConfigSet("project/1", "cs/new");
    expect(exported.manifest.configSetId).toBe("cs-1");

    expect(post).toHaveBeenNthCalledWith(1, "/api/v1/projects/project%2F1/config-sets", { name: "board-a" });
    expect(post).toHaveBeenNthCalledWith(
      2,
      "/api/v1/projects/project%2F1/config-sets/cs%2Fnew/files",
      { fileId: "file/1", role: "base" }
    );
    expect(del).toHaveBeenCalledWith("/api/v1/projects/project%2F1/config-sets/cs%2Fnew/files/file%2F1");
    expect(get).toHaveBeenNthCalledWith(2, "/api/v1/projects/project%2F1/config-sets/cs%2Fnew/export");
  });

  it("maps baseline list/create/compare/rollback/release with envelopes", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ id: "bl-1" }] })
      .mockResolvedValueOnce({ item: { baselineId: "bl/1", members: [] } });
    const post = vi
      .fn()
      .mockResolvedValueOnce({ item: { id: "bl-new", name: "v1", status: "draft" } })
      .mockResolvedValueOnce({ item: { baselineId: "bl/1", restored: 2 } })
      .mockResolvedValueOnce({
        item: { id: "bl/1", status: "released" },
        gate: { ok: true, mode: "block", requiresConfirmation: false, diagnostics: [], compiler: "dtc" }
      });
    const client = createDtsStructuredClient({ get, post } as never);

    const listed = await client.listBaselines("project/1", "cs/1");
    expect(listed).toEqual([{ id: "bl-1" }]);

    const created = await client.createBaseline("project/1", "cs/1", { name: "v1" });
    expect(created).toEqual({ id: "bl-new", name: "v1", status: "draft" });

    const compared = await client.compareBaseline("project/1", "bl/1");
    expect(compared).toEqual({ baselineId: "bl/1", members: [] });

    const rollback = await client.rollbackBaseline("project/1", "bl/1");
    expect(rollback).toEqual({ baselineId: "bl/1", restored: 2 });

    const released = await client.releaseBaseline("project/1", "bl/1");
    expect(released.item.status).toBe("released");
    expect(released.gate.ok).toBe(true);

    expect(get).toHaveBeenNthCalledWith(1, "/api/v1/projects/project%2F1/config-sets/cs%2F1/baselines");
    expect(post).toHaveBeenNthCalledWith(1, "/api/v1/projects/project%2F1/config-sets/cs%2F1/baselines", {
      name: "v1"
    });
    expect(get).toHaveBeenNthCalledWith(2, "/api/v1/projects/project%2F1/baselines/bl%2F1/compare");
    expect(post).toHaveBeenNthCalledWith(2, "/api/v1/projects/project%2F1/baselines/bl%2F1/rollback", {});
    expect(post).toHaveBeenNthCalledWith(3, "/api/v1/projects/project%2F1/baselines/bl%2F1/release", {});
  });
});

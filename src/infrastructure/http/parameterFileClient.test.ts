import { describe, expect, it, vi } from "vitest";

import { createParameterFileClient } from "./parameterFileClient";

describe("createParameterFileClient", () => {
  it("maps list/read endpoints to GET requests", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] });
    const raw = vi.fn(async () => new Response("{}", { status: 200 }));
    const client = createParameterFileClient({ get, raw } as never);

    await client.listFiles("project-1");
    await client.listVersions("project-1", "file/with spaces");
    await client.listConflicts("project-1");
    await client.downloadVersion("project-1", "file/with spaces", "version/1");

    expect(get).toHaveBeenNthCalledWith(1, "/api/v1/projects/project-1/parameter-files");
    expect(get).toHaveBeenNthCalledWith(2, "/api/v1/projects/project-1/parameter-files/file%2Fwith%20spaces/versions");
    expect(get).toHaveBeenNthCalledWith(3, "/api/v1/projects/project-1/parameter-file-conflicts");
    expect(raw).toHaveBeenCalledWith("/api/v1/projects/project-1/parameter-files/file%2Fwith%20spaces/versions/version%2F1/content", {
      method: "GET",
      headers: { Accept: "*/*" }
    });
  });

  it("maps upload/sync/resolve endpoints to POST requests", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ item: { id: "file-1" }, version: { id: "version-1" } })
      .mockResolvedValueOnce({ item: { id: "version-2" } })
      .mockResolvedValueOnce({ item: { draftsCreated: 1, unchanged: 2, unmatched: 3, skipped: false } })
      .mockResolvedValueOnce({ item: { id: "conflict-1", status: "resolved_file" } });
    const client = createParameterFileClient({ post } as never);

    await client.uploadFile("project/1", { fileName: "config.json", contentBase64: "eyJrZXkiOiJ2YWx1ZSJ9" });
    await client.uploadVersion("project/1", "file/1", { fileName: "config.json", contentBase64: "eyJuZXciOiJ2ZXJzaW9uIn0=" });
    await client.syncFile("project/1", "file/1");
    await client.resolveConflict("project/1", "conflict/1", "file");

    expect(post).toHaveBeenNthCalledWith(
      1,
      "/api/v1/projects/project%2F1/parameter-files",
      { fileName: "config.json", contentBase64: "eyJrZXkiOiJ2YWx1ZSJ9" }
    );
    expect(post).toHaveBeenNthCalledWith(
      2,
      "/api/v1/projects/project%2F1/parameter-files/file%2F1/versions",
      { fileName: "config.json", contentBase64: "eyJuZXciOiJ2ZXJzaW9uIn0=" }
    );
    expect(post).toHaveBeenNthCalledWith(3, "/api/v1/projects/project%2F1/parameter-files/file%2F1/sync", {});
    expect(post).toHaveBeenNthCalledWith(
      4,
      "/api/v1/projects/project%2F1/parameter-file-conflicts/conflict%2F1/resolve",
      { resolution: "file" }
    );
  });
});

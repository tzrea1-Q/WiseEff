import { describe, expect, it, vi } from "vitest";
import { createParameterAdminClient } from "./parameterAdminClient";

describe("project lifecycle status writes", () => {
  it.each(["archived", "initialized"])("uses the existing status PATCH for %s without deletion", async (status) => {
    const patch = vi.fn().mockResolvedValue({ item: { id: "project/1", status } });
    const deleteProject = vi.fn();
    const client = createParameterAdminClient({ patch, delete: deleteProject } as never);
    await expect(client.updateProject("project/1", { status })).resolves.toEqual({ id: "project/1", status });
    expect(patch).toHaveBeenCalledWith("/api/v1/parameters/admin/projects/project%2F1", { status });
    expect(deleteProject).not.toHaveBeenCalled();
  });
});

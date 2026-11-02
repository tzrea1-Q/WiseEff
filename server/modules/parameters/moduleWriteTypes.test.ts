import { expect, it, vi } from "vitest";
import { createParameterModuleBodySchema, updateParameterModuleBodySchema } from "./schemas";
import type { CreateParameterModuleBody, MoveParameterModuleBody } from "./schemas";
import type { createParameterModuleForAuth, moveParameterModuleForAuth } from "./service";
import { createParameterModule } from "./parameterModuleRepository";

// These assignments must remain compile errors at both the DTO and service seams.
if (false) {
  // @ts-expect-error legacy technical kinds cannot be created
  const dto: CreateParameterModuleBody = { name: "legacy", kind: "driver-group" };
  // @ts-expect-error the service accepts only writable kinds
  const service: Parameters<typeof createParameterModuleForAuth>[2] = { name: "legacy", kind: "node-type" };
  // @ts-expect-error move requests cannot specify a technical kind
  const moveDto: MoveParameterModuleBody = { parentId: null, kind: "node-type" };
  // @ts-expect-error the move service cannot accept a technical kind
  const moveService: Parameters<typeof moveParameterModuleForAuth>[3] = { parentId: null, kind: "driver-group" };
  // @ts-expect-error the shared writer cannot create a legacy technical module
  const repository: Parameters<typeof createParameterModule>[1] = { organizationId: "org", name: "legacy", kind: "node-type" };
  void [dto, service, moveDto, moveService, repository];
}

it("rejects technical module kinds in write DTOs", () => {
  for (const kind of ["driver-group", "node-type"]) {
    expect(createParameterModuleBodySchema.safeParse({ name: "legacy", kind }).success).toBe(false);
    expect(updateParameterModuleBodySchema.safeParse({ kind }).success).toBe(false);
  }
  expect(createParameterModuleBodySchema.safeParse({ name: "business", kind: "business" }).success).toBe(true);
});

it("rejects technical module creation before the shared writer queries the database", async () => {
  const query = vi.fn();
  for (const kind of ["driver-group", "node-type"]) {
    await expect(createParameterModule({ query }, {
      organizationId: "org", name: "legacy",
      // @ts-expect-error exercise the untyped runtime boundary
      kind,
    })).rejects.toThrow("Only business modules");
  }
  expect(query).not.toHaveBeenCalled();
});

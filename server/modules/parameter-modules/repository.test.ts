import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../shared/database/client";
import { readRegistry, type RegistryCatalogSnapshot } from "./repository";

describe("parameter module canonical registry counts", () => {
  it("counts canonical bindings and active registered definitions, including unbound definitions", async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes("from parameter_modules pm")) {
        return {
          rows: [
            {
              id: "module-root",
              name: "Root",
              parent_id: null,
              sort_order: 0,
              description: "",
              scope: "",
              importance: "medium",
              kind: "business",
              origin: "curated",
              source_key: null,
              attribution_subject_id: null,
              path: "module-root",
            },
            {
              id: "module-leaf",
              name: "Leaf",
              parent_id: "module-root",
              sort_order: 0,
              description: "",
              scope: "",
              importance: "medium",
              kind: "driver-group",
              origin: "curated",
              source_key: null,
              attribution_subject_id: "subject-1",
              path: "module-root/module-leaf",
            },
          ],
        };
      }
      if (text.includes("parameter_catalog.current_project_parameter_bindings")) {
        return {
          rows: [
            { module_id: "module-leaf", subject_id: "subject-1", binding_id: "binding-1" },
            { module_id: "module-leaf", subject_id: "subject-1", binding_id: "binding-2" },
          ],
        };
      }
      if (text.includes("from parameter_module_mappings")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const catalog = {
      listDefinitions: vi.fn(() => ({
        status: "found",
        scope: { kind: "subjects", subjectIds: ["subject-1"] },
        page: {
          items: [
            { id: "definition-1", subjectId: "subject-1" },
            { id: "definition-2", subjectId: "subject-1" },
          ],
          next: { kind: "absent" },
          pageInfo: { totalCount: 2, hasMore: false },
        },
      })),
    } as unknown as RegistryCatalogSnapshot;
    const registry = await readRegistry({ query } as unknown as Queryable, "org-1", catalog);

    expect(registry.modules).toEqual([
      expect.objectContaining({ id: "module-root", parameterCount: 2, definitionCount: 2 }),
      expect.objectContaining({ id: "module-leaf", parameterCount: 2, definitionCount: 2 }),
    ]);
    expect(vi.mocked(catalog.listDefinitions)).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: "subjects", subjectIds: ["subject-1"] },
        lifecycles: ["active"],
      }),
    );
    const canonicalSql = vi.mocked(query).mock.calls.find(([text]) =>
      String(text).includes("current_project_parameter_bindings"),
    )?.[0] as string;
    expect(canonicalSql).not.toContain("catalog_state");
    expect(canonicalSql).not.toContain("catalog_release_subjects");
    expect(canonicalSql).not.toContain("definition_revisions");
  });

  it("returns zero definition facts only when the caller explicitly has no Catalog", async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes("from parameter_modules pm")) {
        return {
          rows: [{
            id: "module",
            name: "Module",
            parent_id: null,
            sort_order: 0,
            description: "",
            scope: "",
            importance: "medium",
            kind: "business",
            origin: "curated",
            source_key: null,
            attribution_subject_id: null,
            path: "module",
          }],
        };
      }
      if (text.includes("current_project_parameter_bindings")) {
        return { rows: [{ module_id: "module", subject_id: "subject-1", binding_id: "binding-1" }] };
      }
      return { rows: [] };
    });

    const registry = await readRegistry({ query } as unknown as Queryable, "org-1", null);
    expect(registry.modules[0]).toEqual(
      expect.objectContaining({ parameterCount: 1, definitionCount: 0 }),
    );
  });

  it("does not turn a captured Catalog read failure into zero definitions", async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes("from parameter_modules pm")) {
        return {
          rows: [{
            id: "module",
            name: "Module",
            parent_id: null,
            sort_order: 0,
            description: "",
            scope: "",
            importance: "medium",
            kind: "business",
            origin: "curated",
            source_key: null,
            attribution_subject_id: null,
            path: "module",
          }],
        };
      }
      if (text.includes("current_project_parameter_bindings")) {
        return { rows: [{ module_id: "module", subject_id: "subject-1", binding_id: "binding-1" }] };
      }
      return { rows: [] };
    });
    const catalog = {
      listDefinitions: vi.fn(() => ({
        status: "invalid-page",
        reason: "release-mismatch",
      })),
    } as unknown as RegistryCatalogSnapshot;

    await expect(
      readRegistry({ query } as unknown as Queryable, "org-1", catalog),
    ).rejects.toThrow("Captured Catalog definition read failed: invalid-page");
  });
});

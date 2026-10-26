import { describe, expect, it, vi } from "vitest";

import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";

import { loadCanonicalDtsDefinitionDetail } from "./loadCanonicalDtsDefinitionDetail";

describe("loadCanonicalDtsDefinitionDetail", () => {
  it("loads the pinned canonical revision instead of the definition currentRevision", async () => {
    const getDefinition = vi.fn();
    const getDefinitionRevision = vi.fn().mockResolvedValue({
      item: {
        id: "revision-3",
        definitionId: "definition-gpio-int",
        revisionNumber: 3,
        contentDigest: "sha256:revision-3",
        displayName: "GPIO 中断（修订 3）",
        valueShape: { kind: "json-schema", schema: { type: "string" } },
        constraints: { kind: "none" },
        documentation: "精确修订 3 的参数说明。",
        unit: { kind: "symbol", symbol: "mA" },
        publishedInCatalogReleaseId: "release-3"
      }
    });
    const repository = {
      getDefinition,
      getDefinitionRevision
    } as unknown as ParameterCatalogRepository;

    const detail = await loadCanonicalDtsDefinitionDetail(repository, {
      definitionId: "definition-gpio-int",
      revisionId: "revision-3",
      propertyKey: "gpio_int"
    });

    expect(getDefinitionRevision).toHaveBeenCalledWith("definition-gpio-int", "revision-3");
    expect(getDefinition).not.toHaveBeenCalled();
    expect(detail).toMatchObject({
      definitionId: "definition-gpio-int",
      revisionId: "revision-3",
      revisionNumber: 3,
      propertyKey: "gpio_int",
      displayName: "GPIO 中断（修订 3）",
      documentation: "精确修订 3 的参数说明。",
      unit: "mA",
      valueShape: { kind: "json-schema", schema: { type: "string" } }
    });
  });

  it("loads the current Catalog revision without rewriting the project pin", async () => {
    const getDefinition = vi.fn().mockResolvedValue({ item: {
      id: "definition-gpio-int", propertyKey: "gpio_int",
      currentRevision: {
        id: "revision-4", definitionId: "definition-gpio-int", revisionNumber: 4,
        displayName: "新说明", documentation: "发布的新说明", contentDigest: "sha256:r4",
        valueShape: { kind: "json-schema", schema: { type: "string" } },
        constraints: { kind: "none" }, unit: null,
        examples: ["example"], publishedInCatalogReleaseId: "release-4"
      }
    } });
    const { loadCurrentCanonicalDtsDefinitionDetail } = await import("./loadCanonicalDtsDefinitionDetail");
    const detail = await loadCurrentCanonicalDtsDefinitionDetail({ getDefinition }, {
      definitionId: "definition-gpio-int", propertyKey: "gpio_int"
    });
    expect(getDefinition).toHaveBeenCalledWith("definition-gpio-int");
    expect(detail).toMatchObject({ revisionId: "revision-4", documentation: "发布的新说明", examples: ["example"] });
  });

  it("propagates canonical 404s and rejects a response for a different revision", async () => {
    const getDefinitionRevision = vi.fn().mockResolvedValue({
      item: {
        id: "revision-other",
        definitionId: "definition-gpio-int",
        revisionNumber: 2,
        contentDigest: "sha256:other",
        displayName: "GPIO 中断（修订 2）",
        valueShape: { kind: "json-schema", schema: { type: "string" } },
        constraints: { kind: "none" },
        documentation: null,
        unit: null,
        publishedInCatalogReleaseId: "release-2"
      }
    });
    const repository = { getDefinitionRevision } as unknown as ParameterCatalogRepository;

    await expect(loadCanonicalDtsDefinitionDetail(repository, {
      definitionId: "definition-gpio-int",
      revisionId: "revision-3",
      propertyKey: "gpio_int"
    })).rejects.toThrow("canonical definition revision identity mismatch");

    const canonicalNotFound = new Error("not found");
    getDefinitionRevision.mockRejectedValueOnce(canonicalNotFound);
    await expect(loadCanonicalDtsDefinitionDetail(repository, {
      definitionId: "definition-gpio-int",
      revisionId: "revision-3",
      propertyKey: "gpio_int"
    })).rejects.toBe(canonicalNotFound);
  });
});

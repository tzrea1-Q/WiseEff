import { catalogBrowserEvidenceRefusal } from "./errors";
import { CATALOG_BROWSER_VIEWPORT_IDS } from "./probes";
import type {
  CatalogBrowserCandidateDriver,
  CatalogBrowserEvidenceSource,
  CatalogBrowserViewportObservation,
} from "./types";

export const createCatalogBrowserCandidateDriver = (
  source: CatalogBrowserEvidenceSource,
): CatalogBrowserCandidateDriver => {
  const byGate = new Map(source.records.map((record) => [record.gateId, record]));
  return {
    kind: "candidate",
    async collect(input) {
      const record = byGate.get(input.gateId);
      const observation: CatalogBrowserViewportObservation | undefined = record?.viewports[input.viewport];
      if (!observation || !CATALOG_BROWSER_VIEWPORT_IDS.includes(input.viewport)) {
        throw catalogBrowserEvidenceRefusal(
          "incomplete-bundle",
          `missing ${input.gateId} ${input.viewport}`,
        );
      }
      return observation;
    },
  };
};

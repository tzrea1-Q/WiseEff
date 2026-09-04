import { browserVerificationGateIds } from "../../core/gateRegistry";

export const CATALOG_BROWSER_GATE_IDS = browserVerificationGateIds;

export const CATALOG_BROWSER_VIEWPORT_IDS = ["1440x900", "768x1024", "390x844"] as const;

export type CatalogBrowserViewportId = (typeof CATALOG_BROWSER_VIEWPORT_IDS)[number];

export const CATALOG_BROWSER_VIEWPORTS = [
  { id: "1440x900", width: 1440, height: 900 },
  { id: "768x1024", width: 768, height: 1024 },
  { id: "390x844", width: 390, height: 844 },
] as const satisfies readonly {
  readonly id: CatalogBrowserViewportId;
  readonly width: number;
  readonly height: number;
}[];

export const CATALOG_BROWSER_OPERATIONS = {
  "PCAT-UI-01": "PCAT-CATALOG-DISCOVER-001",
  "PCAT-UI-02": "PCAT-CATALOG-DEEP-LINK-001",
  "PCAT-UI-03": "PCAT-DEFINITION-DETAIL-001",
  "PCAT-UI-04": "PCAT-REVIEW-RESOLVE-001",
  "PCAT-UI-05": "PCAT-TIMELINE-001",
  "PCAT-UI-06": "PCAT-READY-ACTIONS-001",
  "PCAT-UI-07": "PCAT-REGISTRATION-001",
  "PCAT-UI-08": "PCAT-CATALOG-STATES-001",
  "PCAT-UI-09": "PCAT-RETIRED-HISTORY-001",
  "PCAT-UI-10": "PCAT-CONFLICT-RECONFIRM-001",
  "PCAT-UI-11": "PCAT-LEGACY-LINK-001",
  "PCAT-UI-12": "PCAT-AGENT-READONLY-001",
  "PCAT-UI-13": "PCAT-ADAPTER-PARITY-001",
  "PCAT-UI-14": "PCAT-RESPONSIVE-001",
  "PCAT-UI-15": "PCAT-GOVERNANCE-JOURNEY-001",
} as const satisfies Record<(typeof CATALOG_BROWSER_GATE_IDS)[number], string>;

export const CATALOG_BROWSER_REDACTION_POLICY = "s10-ui-redaction";
export const CATALOG_BROWSER_REDACTION_VERSION = "1";

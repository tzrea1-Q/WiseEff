import type { ParameterImportSourceItem } from "@/application/ports/ParameterRepository";
import type { ParameterRecord } from "@/mockData";
import type { ParameterValueKind } from "@/powerManagementConfig";

export type ImportSourceFormat = "spreadsheet" | "json" | "dts-fragment" | "dts-full";

export type ImportReviewStatus =
  | "pending"
  | "approved"
  | "skipped"
  | "needs-module"
  | "conflict"
  | "new-confirmed";

export type ParsedImportRow = {
  name: string;
  module: string;
  currentValue?: string;
  recommendedValue?: string;
  range?: string;
  unit?: string;
  risk?: ParameterImportSourceItem["risk"];
  description?: string;
  explanation?: string;
  configFormat?: string;
  valueKind?: ParameterValueKind;
  sourceFormat: ImportSourceFormat;
  sourceLocation?: string;
  rawSnippet?: string;
  parseWarnings?: string[];
};

export type ReviewedImportRow = ParsedImportRow & {
  rowId: string;
  status: ImportReviewStatus;
  skipReason?: string;
  existingParameter?: ParameterRecord;
  matchKey: string;
};

export type ImportWizardState = {
  step: 1 | 2 | 3 | 4 | 5;
  targetProjectId: string;
  sourceName: string;
  sourceFormat: ImportSourceFormat | null;
  parsedRows: ParsedImportRow[];
  reviewedRows: ReviewedImportRow[];
  parseErrors: string[];
};

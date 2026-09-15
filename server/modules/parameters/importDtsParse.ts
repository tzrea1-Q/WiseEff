import { parseDts, resolveDts } from "../dts";
import { nodePathToParameterIdentity } from "./pathMapper";
import { ApiError } from "../../shared/http/errors";

export type DtsImportParseRow = {
  name: string;
  module: string;
  sourceNodePath: string;
  rawText: string;
  normalizedValue: string;
  valueType: string;
  skipSuggested?: boolean;
};

export type DtsImportParseDiagnostic = {
  severity: "error" | "warning" | "info";
  message: string;
};

export type DtsImportParseResult = {
  format: "dts-full";
  rows: DtsImportParseRow[];
  diagnostics?: DtsImportParseDiagnostic[];
};

export type ParseDtsImportSourceInput = {
  sourceName: string;
  content: string;
};

const DEFAULT_MAX_CONTENT_BYTES = 2 * 1024 * 1024;

function sourceNodePathFor(nodePath: string, propertyName: string): string {
  return nodePath ? `${nodePath}/${propertyName}` : propertyName;
}

/**
 * Parse a full DTS source into import preview rows using the server CST resolver.
 * `/include/` is not a hard reject here — config-set resolution owns include diagnostics.
 */
export function parseDtsImportSource(
  input: ParseDtsImportSourceInput,
  options: { maxContentBytes?: number } = {}
): DtsImportParseResult {
  const maxBytes = options.maxContentBytes ?? DEFAULT_MAX_CONTENT_BYTES;
  const byteLength = Buffer.byteLength(input.content, "utf8");
  if (byteLength > maxBytes) {
    throw new ApiError("VALIDATION_FAILED", `DTS import source exceeds the ${maxBytes} byte limit.`, {
      maxBytes,
      sizeBytes: byteLength
    });
  }

  const resolved = resolveDts(parseDts(input.content));
  const rows: DtsImportParseRow[] = [];
  const diagnostics: DtsImportParseDiagnostic[] = [];

  for (const node of resolved.nodes) {
    for (const prop of node.properties) {
      const sourceNodePath = sourceNodePathFor(node.nodePath, prop.name);
      let identity: { name: string; module: string };
      try {
        identity = nodePathToParameterIdentity(sourceNodePath);
      } catch {
        diagnostics.push({
          severity: "warning",
          message: `Skipped property with non-hierarchical path: ${sourceNodePath}`
        });
        continue;
      }

      rows.push({
        name: identity.name,
        module: identity.module,
        sourceNodePath,
        rawText: prop.rawText,
        normalizedValue: prop.normalizedValue,
        valueType: prop.valueType
      });
    }
  }

  return {
    format: "dts-full",
    rows,
    ...(diagnostics.length > 0 ? { diagnostics } : {})
  };
}

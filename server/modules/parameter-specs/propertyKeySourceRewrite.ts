import { parseDts, resolveDts } from "../dts";
import { ApiError } from "../../shared/http/errors";

export type PropertyKeySourceRewriteInput = {
  fromKey: string;
  toKey: string;
  nodePath?: string | null;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeNodePath(path: string) {
  return path.trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

export function nodePathsMatch(actual: string, expected: string) {
  const left = normalizeNodePath(actual);
  const right = normalizeNodePath(expected);
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

function locatePropertyNameSpan(
  source: string,
  input: { fromKey: string; valueSpanStart: number; rawText: string; spanStart: number; spanEnd: number },
): { start: number; end: number } {
  if (input.rawText === "") {
    const slice = source.slice(input.spanStart, input.spanEnd);
    const index = slice.indexOf(input.fromKey);
    if (index >= 0) {
      return {
        start: input.spanStart + index,
        end: input.spanStart + index + input.fromKey.length,
      };
    }
  }

  const head = source.slice(0, input.valueSpanStart);
  const match = head.match(new RegExp(`(?:^|[^A-Za-z0-9_])(${escapeRegExp(input.fromKey)})\\s*=\\s*$`));
  if (!match) {
    throw new ApiError("CONFLICT", "Unable to locate property name in source for rewrite.", {
      reason: "missing-property-name-span",
      fromKey: input.fromKey,
    });
  }
  const start = head.lastIndexOf(input.fromKey);
  return { start, end: start + input.fromKey.length };
}

/**
 * Rename a DTS property in source text (old key → new key) without changing
 * the raw value. Used to stage a file-candidate rewrite; does not write live.
 */
export function rewritePropertyKeyInDtsSource(
  source: string,
  input: PropertyKeySourceRewriteInput,
): string {
  const fromKey = input.fromKey.trim();
  const toKey = input.toKey.trim();
  if (!fromKey || !toKey || fromKey === toKey) {
    throw new ApiError("VALIDATION_FAILED", "Property-key source rewrite requires distinct from/to keys.");
  }

  let document;
  try {
    document = parseDts(source);
  } catch (error) {
    throw new ApiError("VALIDATION_FAILED", "Failed to parse DTS content for property-key rewrite.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const resolved = resolveDts(document);
  const nodes = input.nodePath
    ? resolved.nodes.filter((node) => nodePathsMatch(node.nodePath, input.nodePath!))
    : resolved.nodes.filter((node) => node.properties.some((property) => property.name === fromKey));

  const edits: Array<{ start: number; end: number }> = [];
  for (const node of nodes) {
    const from = node.properties.find((property) => property.name === fromKey);
    if (!from) continue;
    if (node.properties.some((property) => property.name === toKey)) {
      throw new ApiError("CONFLICT", "Target property key already exists on this node.", {
        reason: "conflict",
        nodePath: node.nodePath,
        fromKey,
        toKey,
      });
    }
    edits.push(
      locatePropertyNameSpan(source, {
        fromKey,
        valueSpanStart: from.cst.span.start,
        rawText: from.rawText,
        spanStart: from.cst.span.start,
        spanEnd: from.cst.span.end,
      }),
    );
  }

  if (edits.length === 0) {
    throw new ApiError("CONFLICT", "Unable to locate property occurrence for rewrite.", {
      reason: "missing-from-source",
      fromKey,
      nodePath: input.nodePath ?? null,
    });
  }

  edits.sort((left, right) => right.start - left.start);
  let next = source;
  for (const edit of edits) {
    next = `${next.slice(0, edit.start)}${toKey}${next.slice(edit.end)}`;
  }
  return next;
}

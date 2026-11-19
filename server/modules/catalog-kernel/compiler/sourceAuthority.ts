import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { parseAllDocuments } from "yaml";

import {
  serializeContract,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";

import type { CatalogReleaseDocument, CatalogReleaseNode } from "./types";

export interface SourceAuthorityFailure {
  readonly path: string;
  readonly detail:
    "source-yaml-unreadable" | "source-document-envelope-invalid";
}

export interface SourceAuthorityResult {
  readonly documents: readonly CatalogReleaseDocument[];
  readonly failures: readonly SourceAuthorityFailure[];
}

export type CatalogSource = CatalogReleaseNode["sources"][number];

export interface SourceInspection extends SourceAuthorityResult {
  readonly syntaxValid: boolean;
}

const digest = (value: string | Uint8Array): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const exactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
};

export const inspectSource = (
  source: CatalogSource,
  bytes: Uint8Array = Buffer.from(source.bytes, "base64"),
  sourceDigest: string = digest(bytes),
): SourceInspection => {
  const failure = (detail: SourceAuthorityFailure["detail"], syntaxValid: boolean): SourceInspection => ({
    syntaxValid,
    documents: [],
    failures: [{ path: source.path, detail }],
  });
  let syntaxValid = false;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const yamlDocuments = parseAllDocuments(text, { prettyErrors: false });
    syntaxValid = yamlDocuments.length > 0 && yamlDocuments.every((document) => document.errors.length === 0);
    if (!syntaxValid || yamlDocuments.length !== 1) {
      return failure("source-yaml-unreadable", syntaxValid);
    }
    const envelope: unknown = yamlDocuments[0]?.toJS({ maxAliasCount: 0 });
    if (
      !isRecord(envelope) ||
      !exactKeys(envelope, ["schemaVersion", "documents"]) ||
      envelope.schemaVersion !== "1.0.0" ||
      !Array.isArray(envelope.documents) ||
      envelope.documents.length === 0
    ) {
      return failure("source-document-envelope-invalid", syntaxValid);
    }
    const documents: CatalogReleaseDocument[] = [];
    for (const entry of envelope.documents) {
      if (
        !isRecord(entry) ||
        !exactKeys(entry, ["kind", "content"]) ||
        !["subject", "alias", "definition"].includes(String(entry.kind)) ||
        !isRecord(entry.content)
      ) {
        return failure("source-document-envelope-invalid", syntaxValid);
      }
      documents.push({
        source: {
          path: source.path,
          mediaType: source.mediaType,
          digest: sourceDigest,
        },
        kind: entry.kind,
        normalizedDigest: digest(
          serializeContract(entry.content as ContractJsonValue),
        ),
        content: entry.content,
      } as CatalogReleaseDocument);
    }
    return { syntaxValid, documents, failures: [] };
  } catch {
    return failure("source-yaml-unreadable", syntaxValid);
  }
};

export const deriveSourceDocuments = (
  release: CatalogReleaseNode,
  inspections: WeakMap<CatalogSource, SourceInspection>,
): SourceAuthorityResult => {
  const documents: CatalogReleaseDocument[] = [];
  const failures: SourceAuthorityFailure[] = [];
  for (const source of [...release.sources].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  )) {
    const parsed = inspections.get(source) ?? inspectSource(source);
    for (const document of parsed.documents) documents.push(document);
    failures.push(...parsed.failures);
  }
  return { documents, failures };
};

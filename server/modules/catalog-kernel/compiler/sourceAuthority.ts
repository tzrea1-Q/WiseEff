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

const parseSource = (
  source: CatalogReleaseNode["sources"][number],
): SourceAuthorityResult => {
  const bytes = Buffer.from(source.bytes, "base64");
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const yamlDocuments = parseAllDocuments(text, { prettyErrors: false });
    if (yamlDocuments.length !== 1 || yamlDocuments[0]?.errors.length !== 0) {
      throw new TypeError("YAML parse failed");
    }
    const envelope: unknown = yamlDocuments[0]?.toJS({ maxAliasCount: 0 });
    if (
      !isRecord(envelope) ||
      !exactKeys(envelope, ["schemaVersion", "documents"]) ||
      envelope.schemaVersion !== "1.0.0" ||
      !Array.isArray(envelope.documents) ||
      envelope.documents.length === 0
    ) {
      return {
        documents: [],
        failures: [
          { path: source.path, detail: "source-document-envelope-invalid" },
        ],
      };
    }
    const sourceDigest = digest(bytes);
    const documents: CatalogReleaseDocument[] = [];
    for (const entry of envelope.documents) {
      if (
        !isRecord(entry) ||
        !exactKeys(entry, ["kind", "content"]) ||
        !["subject", "alias", "definition"].includes(String(entry.kind)) ||
        !isRecord(entry.content)
      ) {
        return {
          documents: [],
          failures: [
            { path: source.path, detail: "source-document-envelope-invalid" },
          ],
        };
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
    return { documents, failures: [] };
  } catch {
    return {
      documents: [],
      failures: [{ path: source.path, detail: "source-yaml-unreadable" }],
    };
  }
};

export const deriveSourceDocuments = (
  release: CatalogReleaseNode,
): SourceAuthorityResult => {
  const documents: CatalogReleaseDocument[] = [];
  const failures: SourceAuthorityFailure[] = [];
  for (const source of [...release.sources].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  )) {
    const parsed = parseSource(source);
    documents.push(...parsed.documents);
    failures.push(...parsed.failures);
  }
  return { documents, failures };
};

import { createHash } from "node:crypto";

import {
  CatalogCursor,
  serializeContract,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";

export type CatalogCursorOrderTuple = readonly ContractJsonValue[];

export type CatalogCursorPayload = {
  readonly releaseId: string;
  readonly digest: string;
  readonly queryFingerprint: string;
  readonly last: CatalogCursorOrderTuple;
};

const decodeBytes = (value: string): string | null => {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    return Buffer.from(`${padded}${pad}`, "base64").toString("utf8");
  } catch {
    return null;
  }
};

export const fingerprintCatalogQuery = (query: ContractJsonValue): string =>
  `sha256:${createHash("sha256").update(serializeContract(query)).digest("hex")}`;

export const encodeCatalogCursor = (payload: CatalogCursorPayload): CatalogCursor => {
  const json = serializeContract(payload as unknown as ContractJsonValue);
  return CatalogCursor(
    Buffer.from(json, "utf8").toString("base64url").replace(/=+$/g, ""),
  );
};

export const decodeCatalogCursor = (
  cursor: string,
): CatalogCursorPayload | { readonly malformed: true } => {
  const decoded = decodeBytes(cursor);
  if (decoded === null) {
    return { malformed: true };
  }
  try {
    const parsed = JSON.parse(decoded) as Partial<CatalogCursorPayload>;
    if (
      typeof parsed.releaseId !== "string" ||
      typeof parsed.digest !== "string" ||
      typeof parsed.queryFingerprint !== "string" ||
      !Array.isArray(parsed.last)
    ) {
      return { malformed: true };
    }
    return {
      releaseId: parsed.releaseId,
      digest: parsed.digest,
      queryFingerprint: parsed.queryFingerprint,
      last: parsed.last,
    };
  } catch {
    return { malformed: true };
  }
};

export const compareOrderTuples = (
  left: CatalogCursorOrderTuple,
  right: CatalogCursorOrderTuple,
): number => {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftKey = serializeContract(left[index]!);
    const rightKey = serializeContract(right[index]!);
    if (leftKey < rightKey) return -1;
    if (leftKey > rightKey) return 1;
  }
  return left.length - right.length;
};

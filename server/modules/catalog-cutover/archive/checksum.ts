import { createHash } from "node:crypto";

import {
  serializeContract,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";

export const sha256Digest = (value: string | Buffer): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

export const checksumContract = (value: ContractJsonValue): string =>
  sha256Digest(serializeContract(value));

export const archiveGraphChecksum = (input: {
  readonly relationGraph: ContractJsonValue;
  readonly protectedReferences: readonly { readonly kind: string; readonly id: string }[];
}): string =>
  checksumContract({
    relationGraph: input.relationGraph,
    protectedReferences: input.protectedReferences.map((ref) => ({
      kind: ref.kind,
      id: ref.id,
    })),
  });

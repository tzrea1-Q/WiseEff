import type { Queryable } from "../../../shared/database/client";
import { ApiError } from "../../../shared/http/errors";
import type { ObjectStore } from "../../logs/objectStore";
import { serializeContract, type ContractJsonValue } from "../../parameter-catalog-contract";
import { loadCanonicalSourceSnapshot, loadPinnedDtsProperty, readPinnedDtsSourceChange } from "../../parameter-files/canonicalSource";
import { readJsonSourceText, readJsonSourceValue } from "../../parameter-files/jsonSource";
import { dtsValueToPayload } from "../catalogProjectValueSync";
import type { ProjectValuePayload } from "../values";

/** Full source text is returned only after its immutable pin and value agree. */
export async function readCurrentInstanceSourceValue(db: Queryable, objectStore: ObjectStore | undefined, input: {
  organizationId: string; projectId: string; bindingId: string; projectValueId: string; payload: ProjectValuePayload;
}): Promise<string> {
  if (!objectStore) throw new ApiError("CONFLICT", "Exact source storage is unavailable.", { reason: "source-unavailable" });
  const source = await loadCanonicalSourceSnapshot(db, objectStore, input);
  const { manifest } = source;
  const index = manifest.members.findIndex((member) => member.fileId === manifest.fileId && member.fileVersionId === manifest.fileVersionId);
  const file = source.files[index];
  if (!file) throw new ApiError("CONFLICT", "Exact source member is unavailable.", { reason: "source-unavailable" });
  let raw: string;
  let payload: ProjectValuePayload;
  if (manifest.format === "json") {
    if (typeof manifest.locator.pointer !== "string" || manifest.rootPointer === null) throw new ApiError("CONFLICT", "JSON source locator is unavailable.");
    raw = readJsonSourceText(file.content, manifest.locator.pointer, manifest.rootPointer);
    payload = { kind: "json", value: readJsonSourceValue(file.content, manifest.locator.pointer, manifest.rootPointer) as ContractJsonValue };
  } else if (manifest.preprocessing) {
    if (!manifest.logicalNodeId || typeof manifest.locator.propertyOccurrenceId !== "string" ||
      typeof manifest.locator.nodeOccurrenceId !== "string" || typeof manifest.locator.propertyName !== "string") {
      throw new ApiError("CONFLICT", "DTS source locator is unavailable.");
    }
    const { proveExactDtsProperty } = await import("../../parameter-topology/sourcePropertyProof");
    const proof = await proveExactDtsProperty(db, objectStore, { ...manifest, logicalNodeId: manifest.logicalNodeId,
      propertyOccurrenceId: manifest.locator.propertyOccurrenceId, nodeOccurrenceId: manifest.locator.nodeOccurrenceId,
      propertyName: manifest.locator.propertyName });
    raw = (await loadPinnedDtsProperty(db, manifest)).raw_text;
    payload = dtsValueToPayload(proof.value);
  } else {
    const proof = await readPinnedDtsSourceChange(db, manifest, file.content, file.content);
    raw = proof.rawText;
    payload = dtsValueToPayload(proof.value);
  }
  if (serializeContract(payload as ContractJsonValue) !== serializeContract(input.payload as ContractJsonValue)) {
    throw new ApiError("CONFLICT", "Current value disagrees with its pinned source.", { reason: "source-value-disagreement" });
  }
  return raw;
}

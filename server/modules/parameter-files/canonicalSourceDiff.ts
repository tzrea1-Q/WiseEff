import { createHash } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { canViewParameters } from "../parameter-kernel/policy";
import { getCanonicalValueChangeRequest } from "../parameter-bindings/drafts/changeRepository";
import { serializeContract, type ContractJsonValue } from "../parameter-catalog-contract";
import { loadCanonicalSourceSnapshot } from "./canonicalSource";
import { MAX_PARAMETER_SOURCE_BYTES } from "./jsonSource";

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const same = (left: unknown, right: unknown) => serializeContract(left as ContractJsonValue) === serializeContract(right as ContractJsonValue);

/** Read the submitted artifact, including after apply. Never rebuild it from current tips. */
export async function readCanonicalSourceDiff(
  db: Queryable, storage: ObjectStore, auth: AuthContext,
  input: { projectId: string; requestId: string },
) {
  if (!auth.user.isActive || !canViewParameters(auth)) throw new ApiError("FORBIDDEN", "Parameter view permission is required.");
  const request = await getCanonicalValueChangeRequest(db,{ organizationId: auth.organization.id,...input });
  if (!request) throw new ApiError("NOT_FOUND", "Source change request was not found.");
  if (!request.source_pin_id || !request.candidate_id || !request.candidate_binding_manifest
    || !request.candidate_member_manifest) throw new ApiError("CONFLICT", "Submitted source proof is missing.");
  const base = await loadCanonicalSourceSnapshot(db,storage,{
    organizationId: auth.organization.id,projectId: input.projectId,bindingId: request.binding_id,projectValueId: request.base_current_value_id,
  });
  const manifest = base.manifest;
  const members = manifest.members.map((member) => ({ ...member,configSetId: manifest.configSetId,isCandidateFile: member.fileId === manifest.fileId }))
    .sort((left,right) => left.fileId < right.fileId ? -1 : left.fileId > right.fileId ? 1 : 0);
  const candidate = (await db.query<{
    file_id: string; base_version_id: string; format: string; storage_key: string; checksum: string; size_bytes: number;
    base_digest: string; proposed_digest: string; diff_digest: string; frozen_member_manifest: unknown; frozen_binding_manifest: unknown;
  }>(`select *,size_bytes::float8 as size_bytes from project_parameter_file_candidates
    where id=$1 and organization_id=$2 and project_id=$3`, [request.candidate_id,auth.organization.id,input.projectId])).rows[0];
  if (!candidate || request.source_pin_id !== manifest.sourcePinId || request.config_revision_id !== manifest.configRevisionId
    || candidate.file_id !== manifest.fileId || candidate.base_version_id !== manifest.fileVersionId || candidate.format !== manifest.format
    || candidate.base_digest !== request.candidate_base_digest || candidate.proposed_digest !== request.candidate_proposed_digest
    || candidate.diff_digest !== request.candidate_diff_digest || !same(request.candidate_member_manifest,members)
    || !same(candidate.frozen_member_manifest,members) || !same(candidate.frozen_binding_manifest,request.candidate_binding_manifest)) {
    throw new ApiError("CONFLICT", "Submitted source proof is inconsistent.");
  }
  if (!storage.getBounded || !Number.isSafeInteger(candidate.size_bytes) || candidate.size_bytes < 0 || candidate.size_bytes > MAX_PARAMETER_SOURCE_BYTES) {
    throw new ApiError("CONFLICT", "Bounded source storage is required.");
  }
  let bytes: Buffer;
  let after: string;
  try {
    bytes = await storage.getBounded(candidate.storage_key,MAX_PARAMETER_SOURCE_BYTES);
    after = new TextDecoder("utf-8",{ fatal: true,ignoreBOM: true }).decode(bytes);
  } catch {
    throw new ApiError("CONFLICT", "Submitted source object is missing or unreadable.");
  }
  const source = base.files[manifest.members.findIndex((member) => member.fileId === manifest.fileId)]!;
  const before = source.content;
  const bindings = request.candidate_binding_manifest;
  if (bytes.length !== candidate.size_bytes || digest(bytes) !== candidate.checksum.replace(/^sha256:/,"")
    || digest(bytes) !== candidate.proposed_digest || digest(before) !== candidate.base_digest
    || digest(serializeContract({ before,after,sourcePinId: manifest.sourcePinId,bindings } as ContractJsonValue)) !== candidate.diff_digest) {
    throw new ApiError("CONFLICT", "Submitted source diff failed integrity verification.");
  }
  return {
    requestId: request.id,bindingId: request.binding_id,format: manifest.format,sourceName: source.name,
    sourcePinId: manifest.sourcePinId,candidateId: request.candidate_id,
    baseDigest: candidate.base_digest,proposedDigest: candidate.proposed_digest,diffDigest: candidate.diff_digest,
    before,after,bindings,
  };
}

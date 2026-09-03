import type pg from "pg";

import type { RegistrationCommand } from "./command";
import { registrationCommandFamily } from "./command";
import type { RegistrationMethod } from "./result";

export type RegistrationWriterClient = {
  query: pg.PoolClient["query"];
};

export type IdempotencyRow = {
  request_fingerprint: string;
  state: "pending" | "committed";
  result_kind: string | null;
  result_ref: string | null;
};

export type RegistrationRow = {
  id: string;
  organization_id: string;
  subject_id: string;
  status: "active" | "retired";
  registration_method: RegistrationMethod;
  current_placement_id: string;
};

export type PlacementRow = {
  id: string;
  registration_id: string;
  organization_id: string;
  module_id: string;
  origin: "auto" | "curated";
};

export type DestinationModuleRow = {
  id: string;
  organization_id: string;
  parent_id: string | null;
  kind: string;
};

export const loadIdempotency = async (
  client: RegistrationWriterClient,
  organizationId: string,
  idempotencyKey: string,
): Promise<IdempotencyRow | null> => {
  const result = await client.query<IdempotencyRow>(
    `select request_fingerprint, state, result_kind, result_ref
     from parameter_catalog.governance_command_idempotency
     where organization_id = $1
       and command_family = $2
       and idempotency_key = $3
     for update`,
    [organizationId, registrationCommandFamily, idempotencyKey],
  );
  return result.rows[0] ?? null;
};

export const reserveIdempotency = async (
  client: RegistrationWriterClient,
  command: RegistrationCommand,
  fingerprint: string,
): Promise<IdempotencyRow> => {
  await client.query(
    `insert into parameter_catalog.governance_command_idempotency (
       organization_id, command_family, idempotency_key, request_fingerprint, state
     ) values ($1,$2,$3,$4,'pending')
     on conflict (organization_id, command_family, idempotency_key) do nothing`,
    [command.organizationId, registrationCommandFamily, command.idempotencyKey, fingerprint],
  );
  const row = await loadIdempotency(client, command.organizationId, command.idempotencyKey);
  if (row) return row;
  throw new Error("governance idempotency row missing after reserve");
};

export const commitIdempotency = async (
  client: RegistrationWriterClient,
  command: RegistrationCommand,
  resultRef: string,
): Promise<void> => {
  await client.query(
    `update parameter_catalog.governance_command_idempotency
     set state = 'committed',
         result_kind = 'registration',
         result_ref = $4,
         committed_at = now()
     where organization_id = $1
       and command_family = $2
       and idempotency_key = $3
       and state = 'pending'`,
    [
      command.organizationId,
      registrationCommandFamily,
      command.idempotencyKey,
      resultRef,
    ],
  );
};

export const loadRegistrationByOrgSubject = async (
  client: RegistrationWriterClient,
  organizationId: string,
  subjectId: string,
): Promise<RegistrationRow | null> => {
  const result = await client.query<RegistrationRow>(
    `select id, organization_id, subject_id, status, registration_method, current_placement_id
     from parameter_catalog.organization_subject_registrations
     where organization_id = $1 and subject_id = $2
     for update`,
    [organizationId, subjectId],
  );
  return result.rows[0] ?? null;
};

export const loadRegistrationById = async (
  client: RegistrationWriterClient,
  organizationId: string,
  registrationId: string,
): Promise<RegistrationRow | null> => {
  const result = await client.query<RegistrationRow>(
    `select id, organization_id, subject_id, status, registration_method, current_placement_id
     from parameter_catalog.organization_subject_registrations
     where organization_id = $1 and id = $2
     for update`,
    [organizationId, registrationId],
  );
  return result.rows[0] ?? null;
};

export const loadPlacementById = async (
  client: RegistrationWriterClient,
  organizationId: string,
  placementId: string,
): Promise<PlacementRow | null> => {
  const result = await client.query<PlacementRow>(
    `select id, registration_id, organization_id, module_id, origin
     from parameter_catalog.subject_placements
     where organization_id = $1 and id = $2
     for update`,
    [organizationId, placementId],
  );
  return result.rows[0] ?? null;
};

export const insertRegistration = async (
  client: RegistrationWriterClient,
  input: {
    readonly id: string;
    readonly organizationId: string;
    readonly subjectId: string;
    readonly method: RegistrationMethod;
    readonly proof: Record<string, unknown>;
    readonly placementId: string;
  },
): Promise<RegistrationRow> => {
  const result = await client.query<RegistrationRow>(
    `insert into parameter_catalog.organization_subject_registrations (
       id, organization_id, subject_id, status, registration_method, proof, current_placement_id
     ) values ($1,$2,$3,'active',$4,$5::jsonb,$6)
     returning id, organization_id, subject_id, status, registration_method, current_placement_id`,
    [
      input.id,
      input.organizationId,
      input.subjectId,
      input.method,
      JSON.stringify(input.proof),
      input.placementId,
    ],
  );
  return result.rows[0]!;
};

export const insertPlacement = async (
  client: RegistrationWriterClient,
  input: {
    readonly id: string;
    readonly registrationId: string;
    readonly organizationId: string;
    readonly moduleId: string;
    readonly origin: "auto" | "curated";
  },
): Promise<PlacementRow> => {
  const result = await client.query<PlacementRow>(
    `insert into parameter_catalog.subject_placements (
       id, registration_id, organization_id, module_id, origin
     ) values ($1,$2,$3,$4,$5)
     returning id, registration_id, organization_id, module_id, origin`,
    [input.id, input.registrationId, input.organizationId, input.moduleId, input.origin],
  );
  return result.rows[0]!;
};

export const updateRegistrationStatus = async (
  client: RegistrationWriterClient,
  registrationId: string,
  status: "active" | "retired",
): Promise<void> => {
  await client.query(
    `update parameter_catalog.organization_subject_registrations
     set status = $2, updated_at = now()
     where id = $1`,
    [registrationId, status],
  );
};

export const updatePlacementModule = async (
  client: RegistrationWriterClient,
  placementId: string,
  moduleId: string,
): Promise<PlacementRow> => {
  const result = await client.query<PlacementRow>(
    `update parameter_catalog.subject_placements
     set module_id = $2, origin = 'curated', updated_at = now()
     where id = $1
     returning id, registration_id, organization_id, module_id, origin`,
    [placementId, moduleId],
  );
  return result.rows[0]!;
};

export const lockDestinationModule = async (
  client: RegistrationWriterClient,
  organizationId: string,
  moduleId: string,
): Promise<DestinationModuleRow | null> => {
  const result = await client.query<DestinationModuleRow>(
    `select id, organization_id, parent_id, kind
     from public.parameter_modules
     where organization_id = $1 and id = $2
     for share`,
    [organizationId, moduleId],
  );
  return result.rows[0] ?? null;
};

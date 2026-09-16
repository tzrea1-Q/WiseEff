import type { AuthContext } from "../auth/types";
import type { Queryable } from "../../shared/database/client";
import type {
  InsertProductFeedbackAttachmentInput,
  InsertProductFeedbackInput,
  ListMyFeedbackQuery,
  ListMyFeedbackResult,
  ListProductFeedbackQuery,
  ListProductFeedbackResult,
  ProductFeedbackAdminDto,
  ProductFeedbackAttachmentDto,
  ProductFeedbackDto,
  ProductFeedbackProgressEventAdminDto,
  ProductFeedbackProgressEventKind,
  ProductFeedbackProgressEventUserDto,
  ProductFeedbackResolutionCode,
  ProductFeedbackStatus,
  ProductFeedbackType,
  ProductFeedbackUserDto,
  SubmitterIdentityDto,
  UpdateProductFeedbackPatch
} from "./types";

type ProductFeedbackRow = {
  id: string;
  organization_id: string;
  submitter_user_id: string | null;
  submitter_name: string | null;
  submitter_username: string | null;
  page_path: string;
  page_title: string;
  feedback_type: ProductFeedbackType;
  description: string;
  status: ProductFeedbackStatus;
  resolution_code: ProductFeedbackResolutionCode | null;
  admin_note: string | null;
  submitted_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type ProductFeedbackAttachmentRow = {
  id: string;
  feedback_id: string;
  organization_id: string;
  storage_key: string;
  file_name: string;
  content_type: ProductFeedbackAttachmentDto["contentType"];
  size_bytes: number | string;
  checksum: string;
  sort_order: number | string;
  created_at: string | Date;
};

type ProductFeedbackProgressEventRow = {
  id: string;
  organization_id: string;
  feedback_id: string;
  actor_user_id: string | null;
  kind: ProductFeedbackProgressEventKind;
  from_status: ProductFeedbackStatus | null;
  to_status: ProductFeedbackStatus | null;
  resolution_code: ProductFeedbackResolutionCode | null;
  public_message: string | null;
  internal_message: string | null;
  created_at: string | Date;
};

export type InsertProductFeedbackProgressEventInput = {
  id: string;
  feedbackId: string;
  actorUserId?: string | null;
  kind: ProductFeedbackProgressEventKind;
  fromStatus?: ProductFeedbackStatus | null;
  toStatus?: ProductFeedbackStatus | null;
  resolutionCode?: ProductFeedbackResolutionCode | null;
  publicMessage?: string | null;
  internalMessage?: string | null;
  createdAt?: string;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function toAttachmentDto(row: ProductFeedbackAttachmentRow): ProductFeedbackAttachmentDto {
  return {
    id: row.id,
    feedbackId: row.feedback_id,
    organizationId: row.organization_id,
    storageKey: row.storage_key,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    checksum: row.checksum,
    sortOrder: Number(row.sort_order),
    createdAt: dateTimeToIso(row.created_at)
  };
}

function toSubmitterDto(row: ProductFeedbackRow): SubmitterIdentityDto {
  if (!row.submitter_user_id || !row.submitter_name) {
    return {
      id: row.submitter_user_id ?? null,
      name: "已注销用户",
      username: null
    };
  }
  return {
    id: row.submitter_user_id,
    name: row.submitter_name,
    username: row.submitter_username ?? null
  };
}

function toProgressEventUserDto(row: ProductFeedbackProgressEventRow): ProductFeedbackProgressEventUserDto {
  return {
    id: row.id,
    feedbackId: row.feedback_id,
    kind: row.kind,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    resolutionCode: row.resolution_code,
    publicMessage: row.public_message,
    createdAt: dateTimeToIso(row.created_at)
  };
}

function toProgressEventAdminDto(row: ProductFeedbackProgressEventRow): ProductFeedbackProgressEventAdminDto {
  return {
    ...toProgressEventUserDto(row),
    actorUserId: row.actor_user_id,
    internalMessage: row.internal_message
  };
}

function findLatestPublicProgress(events: Array<{ publicMessage: string | null }>): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const msg = events[i].publicMessage?.trim();
    if (msg) return msg;
  }
  return null;
}

function toFeedbackAdminDto(
  row: ProductFeedbackRow,
  attachments: ProductFeedbackAttachmentDto[] = [],
  progressEvents: ProductFeedbackProgressEventAdminDto[] = []
): ProductFeedbackAdminDto {
  return {
    id: row.id,
    organizationId: row.organization_id,
    submitterUserId: row.submitter_user_id,
    submitter: toSubmitterDto(row),
    pagePath: row.page_path,
    pageTitle: row.page_title,
    feedbackType: row.feedback_type,
    description: row.description,
    status: row.status,
    resolutionCode: row.resolution_code,
    adminNote: row.admin_note,
    submittedAt: row.submitted_at ? dateTimeToIso(row.submitted_at) : null,
    createdAt: dateTimeToIso(row.created_at),
    updatedAt: dateTimeToIso(row.updated_at),
    attachments,
    progressEvents,
    latestPublicProgress: findLatestPublicProgress(progressEvents)
  };
}

function toFeedbackUserDto(
  row: ProductFeedbackRow,
  attachments: ProductFeedbackAttachmentDto[] = [],
  progressEvents: ProductFeedbackProgressEventUserDto[] = []
): ProductFeedbackUserDto {
  return {
    id: row.id,
    organizationId: row.organization_id,
    pagePath: row.page_path,
    pageTitle: row.page_title,
    feedbackType: row.feedback_type,
    description: row.description,
    status: row.status,
    resolutionCode: row.resolution_code,
    submittedAt: row.submitted_at ? dateTimeToIso(row.submitted_at) : null,
    createdAt: dateTimeToIso(row.created_at),
    updatedAt: dateTimeToIso(row.updated_at),
    attachments,
    progressEvents,
    latestPublicProgress: findLatestPublicProgress(progressEvents)
  };
}

async function loadAttachmentsForFeedback(
  db: Queryable,
  auth: AuthContext,
  feedbackIds: string[]
): Promise<Map<string, ProductFeedbackAttachmentDto[]>> {
  const result = new Map<string, ProductFeedbackAttachmentDto[]>();
  if (feedbackIds.length === 0) {
    return result;
  }

  const attachmentResult = await db.query<ProductFeedbackAttachmentRow>(
    `
    select *
    from product_feedback_attachments
    where organization_id = $1
      and feedback_id = any($2::uuid[])
    order by feedback_id, sort_order asc, id asc
    `,
    [auth.organization.id, feedbackIds]
  );

  for (const row of attachmentResult.rows) {
    const bucket = result.get(row.feedback_id) ?? [];
    bucket.push(toAttachmentDto(row));
    result.set(row.feedback_id, bucket);
  }

  return result;
}

async function loadAdminProgressEventsForFeedback(
  db: Queryable,
  auth: AuthContext,
  feedbackIds: string[]
): Promise<Map<string, ProductFeedbackProgressEventAdminDto[]>> {
  const result = new Map<string, ProductFeedbackProgressEventAdminDto[]>();
  if (feedbackIds.length === 0) {
    return result;
  }

  const eventResult = await db.query<ProductFeedbackProgressEventRow>(
    `
    select *
    from product_feedback_progress_events
    where organization_id = $1
      and feedback_id = any($2::uuid[])
    order by feedback_id, created_at asc, id asc
    `,
    [auth.organization.id, feedbackIds]
  );

  for (const row of eventResult.rows) {
    const bucket = result.get(row.feedback_id) ?? [];
    bucket.push(toProgressEventAdminDto(row));
    result.set(row.feedback_id, bucket);
  }

  return result;
}

async function loadUserProgressEventsForFeedback(
  db: Queryable,
  auth: AuthContext,
  feedbackIds: string[]
): Promise<Map<string, ProductFeedbackProgressEventUserDto[]>> {
  const result = new Map<string, ProductFeedbackProgressEventUserDto[]>();
  if (feedbackIds.length === 0) {
    return result;
  }

  const eventResult = await db.query<ProductFeedbackProgressEventRow>(
    `
    select *
    from product_feedback_progress_events
    where organization_id = $1
      and feedback_id = any($2::uuid[])
    order by feedback_id, created_at asc, id asc
    `,
    [auth.organization.id, feedbackIds]
  );

  for (const row of eventResult.rows) {
    const bucket = result.get(row.feedback_id) ?? [];
    bucket.push(toProgressEventUserDto(row));
    result.set(row.feedback_id, bucket);
  }

  return result;
}

function addCondition(parts: string[], values: unknown[], condition: (placeholder: string) => string, value: unknown) {
  values.push(value);
  parts.push(condition(`$${values.length}`));
}

function hasPatchKey<Key extends keyof UpdateProductFeedbackPatch>(patch: UpdateProductFeedbackPatch, key: Key) {
  return Object.prototype.hasOwnProperty.call(patch, key);
}

export async function insertProgressEvent(
  db: Queryable,
  auth: AuthContext,
  input: InsertProductFeedbackProgressEventInput
): Promise<ProductFeedbackProgressEventAdminDto> {
  const values: unknown[] = [
    input.id,
    auth.organization.id,
    input.feedbackId,
    input.actorUserId ?? null,
    input.kind,
    input.fromStatus ?? null,
    input.toStatus ?? null,
    input.resolutionCode ?? null,
    input.publicMessage ?? null,
    input.internalMessage ?? null
  ];

  const dateClause = input.createdAt ? `, $11` : ", now()";
  if (input.createdAt) {
    values.push(input.createdAt);
  }

  const result = await db.query<ProductFeedbackProgressEventRow>(
    `
    insert into product_feedback_progress_events (
      id, organization_id, feedback_id, actor_user_id, kind, from_status, to_status, resolution_code, public_message, internal_message, created_at
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10${dateClause})
    returning *
    `,
    values
  );

  return toProgressEventAdminDto(result.rows[0]);
}

export async function insertFeedback(
  db: Queryable,
  auth: AuthContext,
  input: InsertProductFeedbackInput
): Promise<ProductFeedbackAdminDto> {
  const isDraft = input.submittedAt === null;

  const result = await db.query<ProductFeedbackRow>(
    `
    insert into product_feedback (
      id, organization_id, submitter_user_id, page_path, page_title, feedback_type, description, submitted_at
    )
    values ($1, $2, $3, $4, $5, $6, $7, ${isDraft ? "null" : "now()"})
    returning *
    `,
    [input.id, auth.organization.id, auth.user.id, input.pagePath, input.pageTitle, input.feedbackType, input.description]
  );

  if (!isDraft) {
    await insertProgressEvent(db, auth, {
      id: crypto.randomUUID(),
      feedbackId: input.id,
      actorUserId: auth.user.id,
      kind: "submitted",
      toStatus: "open",
      publicMessage: "反馈已提交"
    });
  }

  const detail = await getFeedbackById(db, auth, input.id);
  if (!detail) {
    throw new Error(`Failed to retrieve inserted product feedback: ${input.id}`);
  }
  return detail;
}

export async function insertAttachments(
  db: Queryable,
  auth: AuthContext,
  feedbackId: string,
  attachments: InsertProductFeedbackAttachmentInput[]
): Promise<ProductFeedbackAttachmentDto[]> {
  if (attachments.length === 0) return [];

  const values: unknown[] = [];
  const placeholders = attachments.map((attachment, index) => {
    const offset = index * 9;
    values.push(
      attachment.id,
      feedbackId,
      auth.organization.id,
      attachment.storageKey,
      attachment.fileName,
      attachment.contentType,
      attachment.sizeBytes,
      attachment.checksum,
      attachment.sortOrder
    );
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`;
  });

  const result = await db.query<ProductFeedbackAttachmentRow>(
    `
    insert into product_feedback_attachments (
      id, feedback_id, organization_id, storage_key, file_name, content_type, size_bytes, checksum, sort_order
    )
    select
      input.id::uuid,
      input.feedback_id::uuid,
      input.organization_id,
      input.storage_key,
      input.file_name,
      input.content_type,
      input.size_bytes::integer,
      input.checksum,
      input.sort_order::integer
    from (values ${placeholders.join(", ")}) as input (
      id, feedback_id, organization_id, storage_key, file_name, content_type, size_bytes, checksum, sort_order
    )
    inner join product_feedback feedback
      on feedback.id = input.feedback_id::uuid
      and feedback.organization_id = input.organization_id
    returning *
    `,
    values
  );

  return result.rows.map(toAttachmentDto);
}

export async function getFeedbackById(
  db: Queryable,
  auth: AuthContext,
  id: string
): Promise<ProductFeedbackAdminDto | null> {
  const feedbackResult = await db.query<ProductFeedbackRow>(
    `
    select
      feedback.id,
      feedback.organization_id,
      feedback.submitter_user_id,
      users.name as submitter_name,
      upc.username as submitter_username,
      feedback.page_path,
      feedback.page_title,
      feedback.feedback_type,
      feedback.description,
      feedback.status,
      feedback.resolution_code,
      feedback.admin_note,
      feedback.submitted_at,
      feedback.created_at,
      feedback.updated_at
    from product_feedback feedback
    left join users on users.id = feedback.submitter_user_id
    left join user_password_credentials upc on upc.user_id = feedback.submitter_user_id
    where feedback.organization_id = $1
      and feedback.id = $2
    limit 1
    `,
    [auth.organization.id, id]
  );
  const row = feedbackResult.rows[0];
  if (!row) return null;

  const [attachmentsMap, eventsMap] = await Promise.all([
    loadAttachmentsForFeedback(db, auth, [id]),
    loadAdminProgressEventsForFeedback(db, auth, [id])
  ]);

  return toFeedbackAdminDto(row, attachmentsMap.get(id) ?? [], eventsMap.get(id) ?? []);
}

export async function getMyFeedbackById(
  db: Queryable,
  auth: AuthContext,
  id: string
): Promise<ProductFeedbackUserDto | null> {
  const feedbackResult = await db.query<ProductFeedbackRow>(
    `
    select
      feedback.id,
      feedback.organization_id,
      feedback.submitter_user_id,
      null as submitter_name,
      null as submitter_username,
      feedback.page_path,
      feedback.page_title,
      feedback.feedback_type,
      feedback.description,
      feedback.status,
      feedback.resolution_code,
      null as admin_note,
      feedback.submitted_at,
      feedback.created_at,
      feedback.updated_at
    from product_feedback feedback
    where feedback.organization_id = $1
      and feedback.submitter_user_id = $2
      and feedback.id = $3
    limit 1
    `,
    [auth.organization.id, auth.user.id, id]
  );
  const row = feedbackResult.rows[0];
  if (!row) return null;

  const [attachmentsMap, eventsMap] = await Promise.all([
    loadAttachmentsForFeedback(db, auth, [id]),
    loadUserProgressEventsForFeedback(db, auth, [id])
  ]);

  return toFeedbackUserDto(row, attachmentsMap.get(id) ?? [], eventsMap.get(id) ?? []);
}

export async function listFeedback(
  db: Queryable,
  auth: AuthContext,
  query: ListProductFeedbackQuery
): Promise<ListProductFeedbackResult> {
  const values: unknown[] = [auth.organization.id];
  const where = [
    "feedback.organization_id = $1",
    "feedback.submitted_at is not null"
  ];

  if (query.status) {
    addCondition(where, values, (p) => `feedback.status = ${p}`, query.status);
  }
  if (query.feedbackType) {
    addCondition(where, values, (p) => `feedback.feedback_type = ${p}`, query.feedbackType);
  }
  const q = query.q?.trim();
  if (q) {
    addCondition(
      where,
      values,
      (p) =>
        `(feedback.description ilike ${p} or feedback.page_path ilike ${p} or feedback.page_title ilike ${p} or users.name ilike ${p} or upc.username ilike ${p})`,
      `%${q}%`
    );
  }
  if (query.pagePath) {
    addCondition(where, values, (p) => `feedback.page_path like ${p}`, `${query.pagePath}%`);
  }
  if (query.createdFrom) {
    addCondition(where, values, (p) => `feedback.created_at >= ${p}`, query.createdFrom);
  }
  if (query.createdTo) {
    addCondition(where, values, (p) => `feedback.created_at <= ${p}`, query.createdTo);
  }
  if (query.cursor) {
    values.push(query.cursor.createdAt, query.cursor.id);
    where.push(`(feedback.created_at, feedback.id) < ($${values.length - 1}, $${values.length})`);
  }

  const limit = query.limit ?? 50;
  values.push(limit + 1);
  const result = await db.query<ProductFeedbackRow>(
    `
    select
      feedback.id,
      feedback.organization_id,
      feedback.submitter_user_id,
      users.name as submitter_name,
      upc.username as submitter_username,
      feedback.page_path,
      feedback.page_title,
      feedback.feedback_type,
      feedback.description,
      feedback.status,
      feedback.resolution_code,
      feedback.admin_note,
      feedback.submitted_at,
      feedback.created_at,
      feedback.updated_at
    from product_feedback feedback
    left join users on users.id = feedback.submitter_user_id
    left join user_password_credentials upc on upc.user_id = feedback.submitter_user_id
    where ${where.join("\n      and ")}
    order by feedback.created_at desc, feedback.id desc
    limit $${values.length}
    `,
    values
  );

  const hasMore = result.rows.length > limit;
  const slicedRows = result.rows.slice(0, limit);
  const feedbackIds = slicedRows.map((row) => row.id);

  const [attachmentsMap, eventsMap] = await Promise.all([
    loadAttachmentsForFeedback(db, auth, feedbackIds),
    loadAdminProgressEventsForFeedback(db, auth, feedbackIds)
  ]);

  const items = slicedRows.map((row) =>
    toFeedbackAdminDto(row, attachmentsMap.get(row.id) ?? [], eventsMap.get(row.id) ?? [])
  );
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null
  };
}

export async function listMyFeedback(
  db: Queryable,
  auth: AuthContext,
  query: ListMyFeedbackQuery = {}
): Promise<ListMyFeedbackResult> {
  const values: unknown[] = [auth.organization.id, auth.user.id];
  const where = [
    "feedback.organization_id = $1",
    "feedback.submitter_user_id = $2"
  ];

  if (query.cursor) {
    values.push(query.cursor.updatedAt, query.cursor.id);
    where.push(`(feedback.updated_at, feedback.id) < ($${values.length - 1}, $${values.length})`);
  }

  const limit = query.limit ?? 50;
  values.push(limit + 1);
  const result = await db.query<ProductFeedbackRow>(
    `
    select
      feedback.id,
      feedback.organization_id,
      feedback.submitter_user_id,
      null as submitter_name,
      null as submitter_username,
      feedback.page_path,
      feedback.page_title,
      feedback.feedback_type,
      feedback.description,
      feedback.status,
      feedback.resolution_code,
      null as admin_note,
      feedback.submitted_at,
      feedback.created_at,
      feedback.updated_at
    from product_feedback feedback
    where ${where.join("\n      and ")}
    order by feedback.updated_at desc, feedback.id desc
    limit $${values.length}
    `,
    values
  );

  const hasMore = result.rows.length > limit;
  const slicedRows = result.rows.slice(0, limit);
  const feedbackIds = slicedRows.map((row) => row.id);

  const [attachmentsMap, eventsMap] = await Promise.all([
    loadAttachmentsForFeedback(db, auth, feedbackIds),
    loadUserProgressEventsForFeedback(db, auth, feedbackIds)
  ]);

  const items = slicedRows.map((row) =>
    toFeedbackUserDto(row, attachmentsMap.get(row.id) ?? [], eventsMap.get(row.id) ?? [])
  );
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? { updatedAt: last.updatedAt, id: last.id } : null
  };
}

export async function updateFeedback(
  db: Queryable,
  auth: AuthContext,
  id: string,
  patch: UpdateProductFeedbackPatch
): Promise<ProductFeedbackAdminDto | null> {
  const values: unknown[] = [auth.organization.id, id];
  const sets: string[] = [];

  if (hasPatchKey(patch, "status")) {
    values.push(patch.status);
    sets.push(`status = $${values.length}`);
  }
  if (hasPatchKey(patch, "adminNote")) {
    values.push(patch.adminNote ?? null);
    sets.push(`admin_note = $${values.length}`);
  }

  const setClause = [...sets, "updated_at = now()"].join(",\n      ");
  const result = await db.query<ProductFeedbackRow>(
    `
    update product_feedback
    set ${setClause}
    where organization_id = $1
      and id = $2
    returning *
    `,
    values
  );

  if (!result.rows[0]) {
    return null;
  }

  return getFeedbackById(db, auth, id);
}


import type { AuthContext } from "../auth/types";
import type { Queryable } from "../../shared/database/client";
import type {
  InsertProductFeedbackAttachmentInput,
  InsertProductFeedbackInput,
  ListProductFeedbackQuery,
  ProductFeedbackAttachmentDto,
  ProductFeedbackDto,
  ProductFeedbackStatus,
  ProductFeedbackType,
  UpdateProductFeedbackPatch
} from "./types";

type ProductFeedbackRow = {
  id: string;
  organization_id: string;
  submitter_user_id: string;
  page_path: string;
  page_title: string;
  feedback_type: ProductFeedbackType;
  description: string;
  status: ProductFeedbackStatus;
  admin_note: string | null;
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

function toFeedbackDto(row: ProductFeedbackRow, attachments: ProductFeedbackAttachmentDto[] = []): ProductFeedbackDto {
  return {
    id: row.id,
    organizationId: row.organization_id,
    submitterUserId: row.submitter_user_id,
    pagePath: row.page_path,
    pageTitle: row.page_title,
    feedbackType: row.feedback_type,
    description: row.description,
    status: row.status,
    adminNote: row.admin_note,
    createdAt: dateTimeToIso(row.created_at),
    updatedAt: dateTimeToIso(row.updated_at),
    attachments
  };
}

function addCondition(parts: string[], values: unknown[], condition: (placeholder: string) => string, value: unknown) {
  values.push(value);
  parts.push(condition(`$${values.length}`));
}

function hasPatchKey<Key extends keyof UpdateProductFeedbackPatch>(patch: UpdateProductFeedbackPatch, key: Key) {
  return Object.prototype.hasOwnProperty.call(patch, key);
}

export async function insertFeedback(
  db: Queryable,
  auth: AuthContext,
  input: InsertProductFeedbackInput
): Promise<ProductFeedbackDto> {
  const result = await db.query<ProductFeedbackRow>(
    `
    insert into product_feedback (
      id, organization_id, submitter_user_id, page_path, page_title, feedback_type, description
    )
    values ($1, $2, $3, $4, $5, $6, $7)
    returning *
    `,
    [input.id, auth.organization.id, auth.user.id, input.pagePath, input.pageTitle, input.feedbackType, input.description]
  );

  return toFeedbackDto(result.rows[0]);
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

export async function getFeedbackById(db: Queryable, auth: AuthContext, id: string): Promise<ProductFeedbackDto | null> {
  const feedbackResult = await db.query<ProductFeedbackRow>(
    `
    select *
    from product_feedback
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [auth.organization.id, id]
  );
  const row = feedbackResult.rows[0];
  if (!row) return null;

  const attachmentResult = await db.query<ProductFeedbackAttachmentRow>(
    `
    select *
    from product_feedback_attachments
    where organization_id = $1
      and feedback_id = $2
    order by sort_order asc, id asc
    `,
    [auth.organization.id, id]
  );

  return toFeedbackDto(row, attachmentResult.rows.map(toAttachmentDto));
}

export async function listFeedback(db: Queryable, auth: AuthContext, query: ListProductFeedbackQuery) {
  const values: unknown[] = [auth.organization.id];
  const where = ["organization_id = $1"];

  if (query.status) {
    addCondition(where, values, (placeholder) => `status = ${placeholder}`, query.status);
  }
  if (query.feedbackType) {
    addCondition(where, values, (placeholder) => `feedback_type = ${placeholder}`, query.feedbackType);
  }
  const q = query.q?.trim();
  if (q) {
    addCondition(
      where,
      values,
      (placeholder) => `(description ilike ${placeholder} or page_path ilike ${placeholder} or page_title ilike ${placeholder})`,
      `%${q}%`
    );
  }
  if (query.pagePath) {
    addCondition(where, values, (placeholder) => `page_path like ${placeholder}`, `${query.pagePath}%`);
  }
  if (query.createdFrom) {
    addCondition(where, values, (placeholder) => `created_at >= ${placeholder}`, query.createdFrom);
  }
  if (query.createdTo) {
    addCondition(where, values, (placeholder) => `created_at <= ${placeholder}`, query.createdTo);
  }
  if (query.cursor) {
    values.push(query.cursor.createdAt, query.cursor.id);
    where.push(`(created_at, id) < ($${values.length - 1}, $${values.length})`);
  }

  const limit = query.limit ?? 50;
  values.push(limit + 1);
  const result = await db.query<ProductFeedbackRow>(
    `
    select *
    from product_feedback
    where ${where.join("\n      and ")}
    order by created_at desc, id desc
    limit $${values.length}
    `,
    values
  );

  const hasMore = result.rows.length > limit;
  const items = result.rows.slice(0, limit).map((row) => toFeedbackDto(row));
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null
  };
}

export async function updateFeedback(
  db: Queryable,
  auth: AuthContext,
  id: string,
  patch: UpdateProductFeedbackPatch
): Promise<ProductFeedbackDto | null> {
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

  return result.rows[0] ? toFeedbackDto(result.rows[0]) : null;
}

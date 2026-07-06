import { z } from "zod";
import type { AuthContext } from "../auth/types";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import {
  getUserUnreadNotificationCount,
  listUserNotifications,
  markAllUserNotificationsRead,
  markUserNotificationRead
} from "./service";

const listQuerySchema = z.object({
  unreadOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional()
});

function parseListQuery(query: Record<string, string | string[]>) {
  const raw = Object.fromEntries(
    Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
  );
  return listQuerySchema.parse(raw);
}

export function registerNotificationRoutes(
  router: WiseEffRouter,
  options: { db?: Queryable; getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext }
) {
  router.get("/api/v1/notifications", async (request) => {
    if (!options.db) {
      throw new ApiError("INTERNAL_ERROR", "Database adapter is required for notification reads.", 500);
    }

    const auth = await options.getCurrentAuthContext(request);
    const query = parseListQuery(request.query);
    const result = await listUserNotifications(options.db, {
      organizationId: auth.organization.id,
      recipientUserId: auth.user.id,
      unreadOnly: query.unreadOnly,
      cursor: query.cursor,
      limit: query.limit
    });

    return { status: 200, body: result };
  });

  router.get("/api/v1/notifications/unread-count", async (request) => {
    if (!options.db) {
      throw new ApiError("INTERNAL_ERROR", "Database adapter is required for notification reads.", 500);
    }

    const auth = await options.getCurrentAuthContext(request);
    const result = await getUserUnreadNotificationCount(options.db, {
      organizationId: auth.organization.id,
      recipientUserId: auth.user.id
    });

    return { status: 200, body: result };
  });

  router.post("/api/v1/notifications/:notificationId/read", async (request) => {
    if (!options.db) {
      throw new ApiError("INTERNAL_ERROR", "Database adapter is required for notification writes.", 500);
    }

    const auth = await options.getCurrentAuthContext(request);
    const notificationId = request.params.notificationId;
    const updated = await markUserNotificationRead(options.db, {
      organizationId: auth.organization.id,
      recipientUserId: auth.user.id,
      notificationId
    });

    if (!updated) {
      throw new ApiError("NOT_FOUND", "Notification was not found.", 404, { notificationId });
    }

    return { status: 200, body: updated };
  });

  router.post("/api/v1/notifications/mark-all-read", async (request) => {
    if (!options.db) {
      throw new ApiError("INTERNAL_ERROR", "Database adapter is required for notification writes.", 500);
    }

    const auth = await options.getCurrentAuthContext(request);
    const result = await markAllUserNotificationsRead(options.db, {
      organizationId: auth.organization.id,
      recipientUserId: auth.user.id
    });

    return { status: 200, body: result };
  });
}

import type {
  ListNotificationsParams,
  NotificationItem,
  NotificationListResponse,
  NotificationUnreadCountResponse
} from "@/domain/notifications/types";
import { createApiClient } from "./apiClient";
import { createDefaultApiClient, type DefaultApiClientOptions } from "./defaultApiClient";

type ApiClient = ReturnType<typeof createApiClient>;

export const createDefaultNotificationsApiClient = (options: DefaultApiClientOptions = {}) =>
  createDefaultApiClient(options);

function buildQuery(params: ListNotificationsParams = {}) {
  const search = new URLSearchParams();
  if (params.unreadOnly) search.set("unreadOnly", "true");
  if (params.cursor) search.set("cursor", params.cursor);
  if (params.limit) search.set("limit", String(params.limit));
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function createNotificationsClient(apiClient: ApiClient = createDefaultNotificationsApiClient()) {
  return {
    async listNotifications(params: ListNotificationsParams = {}) {
      return apiClient.get<NotificationListResponse>(`/api/v1/notifications${buildQuery(params)}`);
    },
    async getUnreadCount() {
      return apiClient.get<NotificationUnreadCountResponse>("/api/v1/notifications/unread-count");
    },
    async markRead(notificationId: string) {
      return apiClient.post<NotificationItem>(`/api/v1/notifications/${encodeURIComponent(notificationId)}/read`, {});
    },
    async markAllRead() {
      return apiClient.post<{ updated: number }>("/api/v1/notifications/mark-all-read", {});
    }
  };
}

export type NotificationsClient = ReturnType<typeof createNotificationsClient>;

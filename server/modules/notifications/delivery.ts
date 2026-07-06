import type { MetricsRegistry } from "../../observability/metrics";
import type { NotificationQueue } from "./notificationQueue";

export type NotificationDeliveryMode = "sync" | "async";

export type NotificationDeliveryConfig = {
  mode: NotificationDeliveryMode;
  queue?: NotificationQueue;
  metrics?: Pick<MetricsRegistry, "recordNotificationDeliveryResult" | "setQueueStats">;
};

let notificationDeliveryConfig: NotificationDeliveryConfig = { mode: "sync" };

export function configureNotificationDelivery(config: NotificationDeliveryConfig) {
  notificationDeliveryConfig = config;
}

export function getNotificationDeliveryConfig() {
  return notificationDeliveryConfig;
}

export function resetNotificationDeliveryConfigForTests() {
  notificationDeliveryConfig = { mode: "sync" };
}

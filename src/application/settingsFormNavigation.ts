export type SettingsLeaveRequest = { decision?: Promise<boolean> };

export function requestSettingsLeave(): boolean | Promise<boolean> {
  const event = new CustomEvent<SettingsLeaveRequest>("wiseeff:settings-before-leave", { cancelable: true, detail: {} });
  window.dispatchEvent(event);
  return event.detail.decision ?? !event.defaultPrevented;
}

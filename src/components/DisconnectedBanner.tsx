import { AlertTriangle } from "lucide-react";
import type { Device } from "../mockData";

export function DisconnectedBanner({
  device,
  onConnect
}: {
  device: Device;
  onConnect: () => void;
}) {
  if (device.status === "已连接") {
    return null;
  }

  return (
    <div className="disconnected-banner" role="status" aria-live="polite">
      <AlertTriangle size={18} aria-hidden="true" />
      <div>
        <strong>设备离线：{device.name}</strong>
        <span>你可以先编辑草稿，连接后再统一下发。草稿不会丢失。</span>
      </div>
      <button className="button subtle" type="button" onClick={onConnect}>
        连接样机
      </button>
    </div>
  );
}

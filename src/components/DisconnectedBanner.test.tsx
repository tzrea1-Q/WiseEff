import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DisconnectedBanner } from "./DisconnectedBanner";
import type { Device } from "../mockData";

const offlineDevice: Device = {
  id: "device-x01",
  name: "ChargeLab_X01",
  projectId: "aurora",
  firmware: "v5.2.0-powerlab",
  status: "未连接",
  lastSeen: "10 分钟前"
};

afterEach(() => cleanup());

describe("DisconnectedBanner", () => {
  it("未连接时渲染设备名与说明文案", () => {
    render(<DisconnectedBanner device={offlineDevice} onConnect={() => undefined} />);
    expect(screen.getByRole("status")).toHaveTextContent(/设备离线/);
    expect(screen.getByRole("status")).toHaveTextContent(offlineDevice.name);
    expect(screen.getByText(/草稿不会丢失/)).toBeInTheDocument();
  });

  it("点击连接样机按钮触发 onConnect 回调", () => {
    const handle = vi.fn();
    render(<DisconnectedBanner device={offlineDevice} onConnect={handle} />);
    fireEvent.click(screen.getByRole("button", { name: "连接样机" }));
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("已连接设备不渲染任何内容", () => {
    const online = { ...offlineDevice, status: "已连接" as const };
    const { container } = render(<DisconnectedBanner device={online} onConnect={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("使用 role=status 和 aria-live=polite 以便屏幕阅读器公告", () => {
    render(<DisconnectedBanner device={offlineDevice} onConnect={() => undefined} />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveAttribute("aria-live", "polite");
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DtsReloadRepository } from "@/application/ports/DtsReloadRepository";
import type { DtsReloadCandidate, DtsReloadRun } from "@/domain/dtsReload/types";
import { DtsReloadPage } from "./DtsReloadPage";
import { getRequiredRoleForPage } from "@/app/permissions";

function candidate(overrides: Partial<DtsReloadCandidate> = {}): DtsReloadCandidate {
  return {
    bindingId: "binding-1",
    projectId: "project-1",
    propertyKey: "watchdog_time",
    displayName: "Watchdog",
    module: "charger",
    nodePath: "/amba/i2c@1/dev@6E",
    baselineValue: "<6000>",
    valueShapeKind: "cells",
    unit: "ms",
    constraints: { min: 0, max: 20000, cells: 1 },
    debuggable: true,
    ...overrides
  };
}

function run(overrides: Partial<DtsReloadRun> = {}): DtsReloadRun {
  return {
    id: "run-1",
    projectId: "project-1",
    configRevisionId: null,
    status: "validated",
    failureCode: null,
    targets: [
      {
        bindingId: "binding-1",
        nodePath: "/amba/i2c@1/dev@6E",
        propertyKey: "watchdog_time",
        baselineValue: "<6000>",
        debugValue: "<7000>"
      }
    ],
    steps: [],
    diagnostics: [],
    toolVersions: { dtc: "1.7.0", fdtoverlay: "1.7.0" },
    overlaySource: '/dts-v1/;\n/plugin/;\n\n/ {\n\tfragment@0 {\n\t\ttarget-path = "/amba/i2c@1/dev@6E";\n\t};\n};\n',
    overlaySourceSha256: "sha",
    artifact: { fileName: "debug-overlay-run-1.dtbo", sha256: "sha-art", sizeBytes: 32 },
    createdAt: "2026-08-10T00:00:00.000Z",
    completedAt: "2026-08-10T00:00:01.000Z",
    ...overrides
  };
}

function createRepository(overrides: Partial<DtsReloadRepository> = {}): DtsReloadRepository {
  return {
    listCandidates: vi.fn(async () => ({ items: [candidate()] })),
    startRun: vi.fn(async () => run()),
    getRun: vi.fn(async () => run()),
    downloadArtifact: vi.fn(async () => new Blob([Uint8Array.from([1, 2, 3])])),
    ...overrides
  };
}

describe("DtsReloadPage", () => {
  it("requires committer role for the page", () => {
    expect(getRequiredRoleForPage("dts-reload")).toBe("hardware-committer");
  });

  it("renders a static unavailable state when no repository is injected", () => {
    render(
      <DtsReloadPage
        projects={[{ id: "project-1", name: "Demo" }]}
        repository={null}
        canStartRun={false}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent(/仅在 API 模式下可用/);
  });

  it("lists candidates, starts a run, shows overlay source, and downloads the artifact", async () => {
    const user = userEvent.setup();
    const repository = createRepository();
    const createObjectURL = vi.fn(() => "blob:overlay");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

    render(
      <DtsReloadPage
        projects={[{ id: "project-1", name: "Demo" }]}
        repository={repository}
        canStartRun
      />
    );

    expect(await screen.findByText("Watchdog")).toBeInTheDocument();
    expect(screen.getAllByText("<6000>").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/min 0/).length).toBeGreaterThan(0);

    const debugInput = screen.getByLabelText("调试值");
    await user.clear(debugInput);
    await user.type(debugInput, "<99999>");
    await user.click(screen.getByRole("button", { name: "启动重载运行" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/最大值/);
    expect(repository.startRun).not.toHaveBeenCalled();

    await user.clear(debugInput);
    await user.type(debugInput, "<7000>");
    await user.click(screen.getByRole("button", { name: "启动重载运行" }));

    await waitFor(() => expect(repository.startRun).toHaveBeenCalledWith({
      projectId: "project-1",
      bindingId: "binding-1",
      debugValue: "<7000>"
    }));

    const overlay = await screen.findByLabelText("Overlay 源码");
    expect((overlay as HTMLTextAreaElement).value).toContain("target-path");
    await user.click(screen.getByRole("button", { name: /下载编译产物/ }));
    await waitFor(() => expect(repository.downloadArtifact).toHaveBeenCalledWith("run-1"));
    expect(createObjectURL).toHaveBeenCalled();
  });
});

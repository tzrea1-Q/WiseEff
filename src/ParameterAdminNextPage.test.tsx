import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import type {
  ParameterSpecDetail,
  ParameterSpecSummary,
  SpecReviewTask
} from "@/domain/parameter-topology/types";
import { createMockParameterTopologyRepository } from "@/infrastructure/mock/mockParameterTopologyRepository";
import { ParameterAdminNextPage } from "./ParameterAdminNextPage";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/parameter-admin-next");
});

const SPEC_SUMMARY: ParameterSpecSummary = {
  id: "spec-sc8562-gpio-int",
  organizationId: "org-teaching",
  sourceKind: "dts",
  specificationKey: "dts/sc8562/gpio_int",
  propertyKey: "gpio_int",
  driverModule: "sc8562",
  lifecycle: "active",
  currentVersionId: "specver-sc8562-gpio-int-3",
  currentVersion: 3
};

const SPEC_DETAIL: ParameterSpecDetail = {
  ...SPEC_SUMMARY,
  displayName: "SC8562 GPIO interrupt",
  description: "Interrupt GPIO cells",
  valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 3 },
  schemaDefault: null,
  exampleValue: "<&gpio13 29 0>",
  schemaNamespace: "vendor,sc8562/bindings",
  units: null,
  constraints: { cellsPerGroup: 3 },
  documentation: "gpio_int is a three-cell interrupt specifier.",
  compatiblePatterns: ["vendor,sc8562"],
  policyTarget: null
};

const OPEN_REVIEW_TASK: SpecReviewTask = {
  id: "review-task-gpio-int",
  status: "open",
  parameterSpecId: null,
  propertyKey: "gpio_int",
  driverModule: "unknown-ic",
  evidence: ["compatible unmatched"],
  candidates: [
    {
      id: "spec-sc8562-gpio-int",
      label: "vendor,sc8562 / gpio_int",
      propertyKey: "gpio_int",
      driverModule: "sc8562"
    }
  ],
  ambiguous: true,
  projectCount: 2,
  createdAt: "2026-07-14T10:00:00.000Z"
};

function createRepository(
  overrides: Partial<ParameterTopologyRepository> = {}
): ParameterTopologyRepository {
  return {
    listSpecs: vi.fn().mockResolvedValue([SPEC_SUMMARY]),
    getSpec: vi.fn().mockResolvedValue(SPEC_DETAIL),
    listSpecReviewTasks: vi.fn().mockResolvedValue({ items: [OPEN_REVIEW_TASK], nextCursor: null }),
    resolveSpecReviewTask: vi.fn().mockResolvedValue(undefined),
    activateParameterSpec: vi.fn().mockResolvedValue(SPEC_DETAIL),
    listBindings: vi.fn().mockResolvedValue([]),
    listBindingHistory: vi.fn().mockResolvedValue([]),
    listBindingCompare: vi.fn().mockResolvedValue([]),
    getTopology: vi.fn(),
    listMappingTasks: vi.fn().mockResolvedValue([]),
    resolveMapping: vi.fn(),
    validateRevision: vi.fn(),
    createBindingDraft: vi.fn(),
    ...overrides
  };
}

function renderPage(options: {
  path?: string;
  repository?: ParameterTopologyRepository;
  onNavigate?: ReturnType<typeof vi.fn>;
  area?: "organization" | "projects";
} = {}) {
  const path = options.path ?? "/parameter-admin-next";
  window.history.replaceState(null, "", path);
  const onNavigate = options.onNavigate ?? vi.fn();
  const repository = options.repository ?? createRepository();
  const area =
    options.area ??
    (path.startsWith("/parameter-admin-next/projects") ? "projects" : "organization");
  const search = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";

  render(
    <ParameterAdminNextPage
      area={area}
      onNavigate={onNavigate}
      search={search}
      parameterTopologyRepository={repository}
    />
  );

  return { onNavigate, repository };
}

describe("ParameterAdminNextPage · shell", () => {
  it("presents organization and project areas as peer destinations", () => {
    const { onNavigate } = renderPage();

    const nav = screen.getByRole("navigation", { name: "参数管理后台治理范围" });
    expect(within(nav).getByRole("button", { name: "组织治理" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("button", { name: "项目运营" })).not.toHaveAttribute("aria-current");

    fireEvent.click(within(nav).getByRole("button", { name: "项目运营" }));
    expect(onNavigate).toHaveBeenCalledWith("/parameter-admin-next/projects");
  });

  it("opens the project area as its own destination", async () => {
    renderPage({ path: "/parameter-admin-next/projects", area: "projects" });

    const nav = screen.getByRole("navigation", { name: "参数管理后台治理范围" });
    expect(within(nav).getByRole("button", { name: "项目运营" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("region", { name: "项目运营" })).toBeInTheDocument();
    expect(screen.getByText(/项目参数文件与配置集将在后续任务交付/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "参数规格库" })).not.toBeInTheDocument();
  });
});

describe("ParameterAdminNextPage · organization spec governance", () => {
  it("loads the spec library through the injected topology port", async () => {
    const repository = createRepository();
    renderPage({ repository });

    const library = await screen.findByRole("region", { name: "参数规格库" });
    expect(within(library).getByText("gpio_int")).toBeInTheDocument();
    expect(repository.listSpecs).toHaveBeenCalled();
    expect(repository.listSpecReviewTasks).toHaveBeenCalledWith(
      expect.objectContaining({ status: "open" })
    );
  });

  it("keeps filters, sort, and selection in the URL", async () => {
    const repository = createRepository();
    renderPage({ repository });

    await screen.findByRole("region", { name: "参数规格库" });

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索规格" }), {
      target: { value: "gpio" }
    });
    fireEvent.change(screen.getByRole("combobox", { name: "生命周期" }), {
      target: { value: "active" }
    });
    fireEvent.change(screen.getByRole("combobox", { name: "排序" }), {
      target: { value: "propertyKey-desc" }
    });
    fireEvent.click(screen.getByRole("button", { name: "查看 gpio_int" }));

    await waitFor(() => {
      const params = new URL(window.location.href).searchParams;
      expect(params.get("q")).toBe("gpio");
      expect(params.get("lifecycle")).toBe("active");
      expect(params.get("sort")).toBe("propertyKey-desc");
      expect(params.get("spec")).toBe("spec-sc8562-gpio-int");
    });
  });

  it("opens spec detail with schema provenance", async () => {
    const repository = createRepository();
    renderPage({
      repository,
      path: "/parameter-admin-next?spec=spec-sc8562-gpio-int"
    });

    const detail = await screen.findByRole("region", { name: "规格详情" });
    expect(within(detail).getByText("gpio_int")).toBeInTheDocument();
    const history = within(detail).getByRole("region", { name: "Schema 历史" });
    expect(within(history).getByText(/v3 · vendor,sc8562\/bindings/)).toBeInTheDocument();
    expect(repository.getSpec).toHaveBeenCalledWith("spec-sc8562-gpio-int");
  });

  it("resolves a spec review task and surfaces a governance audit record", async () => {
    const listSpecReviewTasks = vi
      .fn()
      .mockResolvedValueOnce({ items: [OPEN_REVIEW_TASK], nextCursor: null })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    const resolveSpecReviewTask = vi.fn().mockResolvedValue(undefined);
    const repository = createRepository({ listSpecReviewTasks, resolveSpecReviewTask });

    renderPage({ repository });

    const queue = await screen.findByRole("region", { name: "规格审核队列" });
    expect(within(queue).getByText("compatible unmatched")).toBeInTheDocument();

    fireEvent.change(within(queue).getByRole("combobox", { name: "选择 Schema" }), {
      target: { value: "spec-sc8562-gpio-int" }
    });
    fireEvent.change(within(queue).getByLabelText("审核原因"), {
      target: { value: "Matched SC8562" }
    });
    fireEvent.click(within(queue).getByRole("button", { name: "批准" }));

    await waitFor(() =>
      expect(resolveSpecReviewTask).toHaveBeenCalledWith("review-task-gpio-int", {
        decision: "resolved",
        parameterSpecId: "spec-sc8562-gpio-int",
        reason: "Matched SC8562"
      })
    );
    await waitFor(() => expect(within(queue).getByText("没有待审核的推理规格。")).toBeInTheDocument());

    const audit = screen.getByRole("status", { name: "治理审计" });
    expect(audit).toHaveTextContent(/spec-review-resolved/);
    expect(audit).toHaveTextContent(/Matched SC8562/);
  });

  it("dismisses a spec review task with a governance audit record", async () => {
    const listSpecReviewTasks = vi
      .fn()
      .mockResolvedValueOnce({ items: [OPEN_REVIEW_TASK], nextCursor: null })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    const resolveSpecReviewTask = vi.fn().mockResolvedValue(undefined);
    const repository = createRepository({ listSpecReviewTasks, resolveSpecReviewTask });

    renderPage({ repository });

    const queue = await screen.findByRole("region", { name: "规格审核队列" });
    fireEvent.change(within(queue).getByLabelText("审核原因"), {
      target: { value: "Not actionable" }
    });
    fireEvent.click(within(queue).getByRole("button", { name: "驳回" }));

    await waitFor(() =>
      expect(resolveSpecReviewTask).toHaveBeenCalledWith("review-task-gpio-int", {
        decision: "dismissed",
        reason: "Not actionable"
      })
    );
    await waitFor(() => expect(within(queue).getByText("没有待审核的推理规格。")).toBeInTheDocument());
    expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/spec-review-dismissed/);
  });

  it("creates a draft spec from an unmatched review task with audit", async () => {
    const unmatched: SpecReviewTask = {
      ...OPEN_REVIEW_TASK,
      id: "review-task-mystery",
      propertyKey: "mystery_prop",
      driverModule: null,
      candidates: [],
      ambiguous: false,
      evidence: ["no schema match"]
    };
    const listSpecReviewTasks = vi
      .fn()
      .mockResolvedValueOnce({ items: [unmatched], nextCursor: null })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    const resolveSpecReviewTask = vi.fn().mockResolvedValue(undefined);
    const repository = createRepository({ listSpecReviewTasks, resolveSpecReviewTask });

    renderPage({ repository });

    const queue = await screen.findByRole("region", { name: "规格审核队列" });
    fireEvent.change(within(queue).getByLabelText("审核原因"), {
      target: { value: "Need manual draft" }
    });
    fireEvent.click(within(queue).getByRole("button", { name: "创建草稿规格" }));

    await waitFor(() =>
      expect(resolveSpecReviewTask).toHaveBeenCalledWith("review-task-mystery", {
        decision: "resolved",
        createSpec: true,
        reason: "Need manual draft"
      })
    );
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/spec-review-create-spec/)
    );
    expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/草稿规格「mystery_prop」已创建/);
  });

  it("behaves identically when backed by the mock topology adapter", async () => {
    const repository = createMockParameterTopologyRepository();
    renderPage({ repository });

    const library = await screen.findByRole("region", { name: "参数规格库" });
    expect(within(library).getAllByText("gpio_int").length).toBeGreaterThan(0);
    expect(within(library).getAllByRole("button", { name: "查看 gpio_int" }).length).toBeGreaterThan(0);

    const queue = await screen.findByRole("region", { name: "规格审核队列" });
    fireEvent.change(within(queue).getByRole("combobox", { name: "选择 Schema" }), {
      target: { value: "spec-sc8562-gpio-int" }
    });
    fireEvent.change(within(queue).getByLabelText("审核原因"), {
      target: { value: "Mock approve" }
    });
    fireEvent.click(within(queue).getByRole("button", { name: "批准" }));

    await waitFor(() => expect(within(queue).getByText("没有待审核的推理规格。")).toBeInTheDocument());
    expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/spec-review-resolved/);
  });
});

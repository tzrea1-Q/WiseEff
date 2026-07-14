import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DtsStructuralNode,
  DtsStructuredRepository
} from "@/application/ports/DtsStructuredRepository";
import { DtsStructureBrowserPanel } from "./DtsStructureBrowserPanel";

const PROJECT_ID = "atlas";
const TEACHING_FILE_ID = "file-teaching-dts";
const TEACHING_VERSION_ID = "version-teaching-1";

function node(overrides: Partial<DtsStructuralNode> & { nodePath: string }): DtsStructuralNode {
  return {
    name: overrides.nodePath.split("/").pop() ?? overrides.nodePath,
    labels: [],
    properties: [],
    phandleRefs: [],
    ...overrides
  };
}

const TEACHING_NODES: DtsStructuralNode[] = [
  node({
    nodePath: "demo_bool",
    labels: ["demo_bool"],
    properties: [
      {
        name: "weak_source_sleep_enabled",
        valueType: "bool",
        rawText: "",
        normalizedValue: "true"
      }
    ]
  }),
  node({
    nodePath: "demo_regulator",
    labels: ["demo_regulator"],
    properties: [
      {
        name: "regulator-min-microvolt",
        valueType: "u32-array",
        rawText: "<1000000>",
        normalizedValue: "1000000"
      }
    ]
  }),
  node({
    nodePath: "thermal-zone@0",
    labels: [],
    properties: [
      {
        name: "polling-delay",
        valueType: "u32-array",
        rawText: "<1000>",
        normalizedValue: "1000"
      }
    ]
  })
];

function createRepository(overrides: Partial<DtsStructuredRepository> = {}): DtsStructuredRepository {
  return {
    getStructure: vi.fn().mockResolvedValue({ nodes: TEACHING_NODES }),
    search: vi.fn().mockResolvedValue({ hits: [] }),
    listConfigSets: vi.fn().mockResolvedValue([]),
    createConfigSet: vi.fn(),
    addConfigSetFile: vi.fn(),
    removeConfigSetFile: vi.fn(),
    listBaselines: vi.fn().mockResolvedValue([]),
    createBaseline: vi.fn(),
    compareBaseline: vi.fn(),
    rollbackBaseline: vi.fn(),
    releaseBaseline: vi.fn(),
    exportConfigSet: vi.fn(),
    ...overrides
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DtsStructureBrowserPanel", () => {
  it("auto-loads teaching structure and mounts StructuredValueEditor on property select", async () => {
    const repository = createRepository();

    render(
      <DtsStructureBrowserPanel projectId={PROJECT_ID} repository={repository} canEditCritical />
    );

    await waitFor(() => {
      expect(repository.getStructure).toHaveBeenCalledWith(
        PROJECT_ID,
        TEACHING_FILE_ID,
        TEACHING_VERSION_ID
      );
    });

    const panel = await screen.findByRole("region", { name: "结构浏览" });
    fireEvent.click(within(panel).getByRole("treeitem", { name: "demo_bool" }));

    const propertyButton = within(panel).getByRole("button", {
      name: /编辑属性 weak_source_sleep_enabled/
    });
    fireEvent.click(propertyButton);

    expect(within(panel).getByRole("checkbox", { name: "布尔开关" })).toBeInTheDocument();
    expect(within(panel).getByLabelText("规范化预览")).toHaveTextContent("true");

    fireEvent.click(within(panel).getByRole("checkbox", { name: "布尔开关" }));
    expect(within(panel).getByLabelText("规范化预览")).toHaveTextContent("true");
  });

  it("disables editor for critical nodes when canEditCritical is false", async () => {
    const repository = createRepository();

    render(
      <DtsStructureBrowserPanel
        projectId={PROJECT_ID}
        repository={repository}
        canEditCritical={false}
      />
    );

    const panel = await screen.findByRole("region", { name: "结构浏览" });
    fireEvent.click(within(panel).getByRole("treeitem", { name: "demo_regulator" }));
    fireEvent.click(
      within(panel).getByRole("button", { name: /编辑属性 regulator-min-microvolt/ })
    );

    expect(
      within(panel).getByText(/需要 parameter:edit-critical 权限才能编辑安全关键节点/)
    ).toBeInTheDocument();
    expect(within(panel).getByLabelText("cell 1")).toBeDisabled();
  });

  it("allows loading teaching structure via explicit button when auto-load was skipped", async () => {
    const repository = createRepository({
      getStructure: vi
        .fn()
        .mockResolvedValueOnce({ nodes: [] })
        .mockResolvedValue({ nodes: TEACHING_NODES })
    });

    render(
      <DtsStructureBrowserPanel
        projectId={PROJECT_ID}
        repository={repository}
        fileId="file-empty"
        versionId="version-empty"
        canEditCritical
      />
    );

    await waitFor(() => {
      expect(repository.getStructure).toHaveBeenCalledWith(
        PROJECT_ID,
        "file-empty",
        "version-empty"
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "加载教学结构" }));

    await waitFor(() => {
      expect(repository.getStructure).toHaveBeenCalledWith(
        PROJECT_ID,
        TEACHING_FILE_ID,
        TEACHING_VERSION_ID
      );
    });

    expect(await screen.findByRole("treeitem", { name: "demo_bool" })).toBeInTheDocument();
  });
});

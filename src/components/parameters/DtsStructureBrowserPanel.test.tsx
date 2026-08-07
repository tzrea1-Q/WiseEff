import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DtsStructuralNode,
  DtsStructuredRepository
} from "@/application/ports/DtsStructuredRepository";
import { DtsStructureBrowserPanel } from "./DtsStructureBrowserPanel";

const PROJECT_ID = "atlas";
const FILE_ID = "file-board";
const VERSION_ID = "version-board-3";

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
    getReleaseReadiness: vi.fn(async () => ({
      available: true,
      level: "ready",
      blockers: [],
      warnings: [],
      gateToken: "gate-token-test",
      evaluatedAt: "2026-08-07T00:00:00.000Z",
      configSetId: "cs-1",
      projectId: "project-1",
      canCreateBaseline: true,
      canRelease: true
    })),
    compareBaseline: vi.fn(),
    rollbackBaseline: vi.fn(),
    releaseBaseline: vi.fn(),
    exportConfigSet: vi.fn(),
    submitStructuredEdits: vi.fn().mockResolvedValue({
      id: "round-1",
      projectId: PROJECT_ID,
      status: "submitted",
      items: [
        {
          parameterId: "ppv-bool",
          targetValue: "",
          reason: "structured edit"
        }
      ]
    }),
    ...overrides
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DtsStructureBrowserPanel", () => {
  it("loads the given file version and mounts StructuredValueEditor on property select", async () => {
    const repository = createRepository();

    render(
      <DtsStructureBrowserPanel
        projectId={PROJECT_ID}
        repository={repository}
        fileId={FILE_ID}
        versionId={VERSION_ID}
        canEditCritical
      />
    );

    await waitFor(() => {
      expect(repository.getStructure).toHaveBeenCalledWith(PROJECT_ID, FILE_ID, VERSION_ID);
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
        fileId={FILE_ID}
        versionId={VERSION_ID}
        canEditCritical={false}
      />
    );

    const panel = await screen.findByRole("region", { name: "结构浏览" });
    fireEvent.click(within(panel).getByRole("treeitem", { name: "demo_regulator" }));
    fireEvent.click(
      within(panel).getByRole("button", { name: /编辑属性 regulator-min-microvolt/ })
    );

    // One authoritative locked state in product language, not a permission slug.
    expect(within(panel).getByText(/安全关键节点，你的角色没有修改它的权限/)).toBeInTheDocument();
    expect(within(panel).queryByText(/parameter:edit-critical/)).not.toBeInTheDocument();
    expect(within(panel).getByLabelText("cell 1")).toBeDisabled();
  });

  it("names a real next action instead of offering a teaching fixture when there is nothing to browse", async () => {
    const repository = createRepository({
      getStructure: vi.fn().mockResolvedValue({ nodes: [] })
    });

    const { unmount } = render(
      <DtsStructureBrowserPanel
        projectId={PROJECT_ID}
        repository={repository}
        fileId="file-empty"
        versionId="version-empty"
        canEditCritical
      />
    );

    expect(await screen.findByText(/没有解析出结构节点/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /教学/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/file-teaching-dts|mock/)).not.toBeInTheDocument();

    unmount();
    const idleRepository = createRepository();
    render(<DtsStructureBrowserPanel projectId={PROJECT_ID} repository={idleRepository} />);

    expect(await screen.findByText(/还没有指定要浏览的结构文件/)).toBeInTheDocument();
    expect(idleRepository.getStructure).not.toHaveBeenCalled();
  });

  it("selects the node a search hit asked for, and says so when it is in another file", async () => {
    const repository = createRepository();

    const { rerender } = render(
      <DtsStructureBrowserPanel
        projectId={PROJECT_ID}
        repository={repository}
        fileId={FILE_ID}
        versionId={VERSION_ID}
        focusRequest={{ nodePath: "demo_regulator", token: 1 }}
      />
    );

    const panel = await screen.findByRole("region", { name: "结构浏览" });
    await waitFor(() =>
      expect(within(panel).getByRole("treeitem", { name: "demo_regulator" })).toHaveAttribute(
        "aria-selected",
        "true"
      )
    );

    rerender(
      <DtsStructureBrowserPanel
        projectId={PROJECT_ID}
        repository={repository}
        fileId={FILE_ID}
        versionId={VERSION_ID}
        focusRequest={{
          nodePath: "demo_bool",
          propertyName: "weak_source_sleep_enabled",
          token: 2
        }}
      />
    );
    expect(
      await within(panel).findByRole("checkbox", { name: "布尔开关" })
    ).toBeInTheDocument();

    rerender(
      <DtsStructureBrowserPanel
        projectId={PROJECT_ID}
        repository={repository}
        fileId={FILE_ID}
        versionId={VERSION_ID}
        focusRequest={{ nodePath: "somewhere/else", token: 3 }}
      />
    );
    expect(await within(panel).findByText(/不在当前浏览的文件里/)).toBeInTheDocument();
  });

  it("aggregates local edits into a change-set and submits via Port with rawText", async () => {
    const nodes: DtsStructuralNode[] = [
      node({
        nodePath: "amba/i2c@XXXX0000",
        properties: [
          {
            name: "mixed_case_reg",
            valueType: "bytes",
            rawText: "/bits/ 8 <0xab 0xcd>",
            normalizedValue: "/bits/ 8 <0xab 0xcd>"
          }
        ]
      })
    ];
    const submitStructuredEdits = vi.fn().mockResolvedValue({
      id: "round-hex",
      projectId: PROJECT_ID,
      status: "submitted",
      items: [
        {
          parameterId: "ppv-hex",
          targetValue: "/bits/ 8 <0xAB 0xCD>",
          reason: "structured edit"
        }
      ]
    });
    const repository = createRepository({
      getStructure: vi.fn().mockResolvedValue({ nodes }),
      submitStructuredEdits
    });

    render(
      <DtsStructureBrowserPanel
        projectId={PROJECT_ID}
        repository={repository}
        fileId="file-board"
        versionId="ver-1"
        canEdit
        canEditCritical
      />
    );

    const panel = await screen.findByRole("region", { name: "结构浏览" });
    fireEvent.click(within(panel).getByRole("treeitem", { name: "amba/i2c@XXXX0000" }));
    fireEvent.click(within(panel).getByRole("button", { name: /编辑属性 mixed_case_reg/ }));

    const byte1 = within(panel).getByLabelText("byte 1");
    fireEvent.change(byte1, { target: { value: "0xAB" } });
    const byte2 = within(panel).getByLabelText("byte 2");
    fireEvent.change(byte2, { target: { value: "0xCD" } });

    const changeSet = await within(panel).findByRole("region", { name: "变更集" });
    expect(within(changeSet).getByText(/已映射|待提交/)).toBeInTheDocument();

    const submit = within(panel).getByRole("button", { name: /提交变更请求/ });
    expect(submit).toHaveClass("primary");
    expect(submit).toHaveAccessibleName("提交变更请求（1 项）");
    fireEvent.click(submit);

    await waitFor(() => {
      expect(submitStructuredEdits).toHaveBeenCalledWith(
        PROJECT_ID,
        expect.objectContaining({
          edits: [
            expect.objectContaining({
              fileId: "file-board",
              nodePath: "amba/i2c@XXXX0000",
              propertyName: "mixed_case_reg",
              rawText: expect.stringMatching(/0xAB/i)
            })
          ]
        })
      );
    });

    expect(await within(panel).findByText(/已提交变更请求/)).toBeInTheDocument();
    expect(within(panel).getByText(/ppv-hex/)).toBeInTheDocument();
  });

  it("disables submit when canEdit is false", async () => {
    const repository = createRepository();

    render(
      <DtsStructureBrowserPanel
        projectId={PROJECT_ID}
        repository={repository}
        fileId={FILE_ID}
        versionId={VERSION_ID}
        canEdit={false}
        canEditCritical={false}
      />
    );

    const panel = await screen.findByRole("region", { name: "结构浏览" });
    fireEvent.click(within(panel).getByRole("treeitem", { name: "demo_bool" }));
    fireEvent.click(
      within(panel).getByRole("button", { name: /编辑属性 weak_source_sleep_enabled/ })
    );

    expect(within(panel).getByRole("checkbox", { name: "布尔开关" })).toBeDisabled();
    expect(within(panel).queryByRole("button", { name: "提交变更请求" })).not.toBeInTheDocument();
  });
});

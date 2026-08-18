import { describe, expect, it } from "vitest";

import {
  formatPropertyKeyCutoverWorkbenchHref,
  presentFileCandidateHandoffStatus,
  propertyKeyCutoverHandoffLinkLabel,
} from "./propertyKeyCutoverHandoff";

describe("property-key cutover workbench handoff", () => {
  it("builds a configuration-workbench candidate review href without leaking ids into the label", () => {
    expect(
      formatPropertyKeyCutoverWorkbenchHref({
        projectId: "p1",
        configSetId: "cs-default",
        candidateId: "cand-1",
        fileId: "file-board",
        nodePath: "/charger@6e",
      }),
    ).toBe(
      "/parameter-admin/projects/p1/configuration?configSet=cs-default&file=file-board&node=%2Fcharger%406e&sourceMode=candidate&candidate=cand-1&inspector=file",
    );
    expect(propertyKeyCutoverHandoffLinkLabel("board.dts")).toBe("在配置工作台审阅并合入 board.dts");
    expect(propertyKeyCutoverHandoffLinkLabel(null)).toBe("在配置工作台审阅并合入该文件草稿");
    expect(propertyKeyCutoverHandoffLinkLabel("board.dts", "abandoned")).toBe("在配置工作台查看 board.dts");
    expect(propertyKeyCutoverHandoffLinkLabel(null, "active")).toBe("在配置工作台查看该文件草稿");
  });

  it("returns no href when the staged rewrite cannot be opened in the workbench", () => {
    expect(
      formatPropertyKeyCutoverWorkbenchHref({
        projectId: null,
        configSetId: "cs-default",
        candidateId: "cand-1",
      }),
    ).toBeNull();
    expect(
      formatPropertyKeyCutoverWorkbenchHref({
        projectId: "p1",
        candidateId: "cand-1",
      }),
    ).toBeNull();
    expect(
      formatPropertyKeyCutoverWorkbenchHref({
        projectId: "p1",
        configSetId: "cs-default",
        candidateId: "",
      }),
    ).toBeNull();
  });

  it("presents live file-candidate statuses in product Chinese", () => {
    expect(presentFileCandidateHandoffStatus("ready")).toBe("已暂存");
    expect(presentFileCandidateHandoffStatus("active")).toBe("已合入现行源");
    expect(presentFileCandidateHandoffStatus("abandoned")).toBe("已放弃");
    expect(presentFileCandidateHandoffStatus("stale")).toBe("候选已过期");
    expect(presentFileCandidateHandoffStatus("blocked")).toBe("候选被阻断");
    expect(presentFileCandidateHandoffStatus("failed")).toBe("候选失败");
    expect(presentFileCandidateHandoffStatus("missing")).toBe("候选已不可用");
  });
});

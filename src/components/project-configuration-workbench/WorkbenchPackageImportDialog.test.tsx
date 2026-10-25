import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { WorkbenchPackageImportDialog } from "./WorkbenchPackageImportDialog";
import type { ConfigSetImportPreview } from "@wiseeff/dto-schemas";

afterEach(cleanup);
it("selects an explicit raw source root and invalidates proof when overlay order changes",async()=>{
  const user=userEvent.setup();
  const client={preview:vi.fn().mockResolvedValueOnce({kind:"source-selection",members:[{sourceName:"board.dts",format:"dts"},{sourceName:"first.dtsi",format:"dts"},{sourceName:"last.dtsi",format:"dts"}]}).mockResolvedValue(result),apply:vi.fn()};
  render(<WorkbenchPackageImportDialog projectId="project" client={client} onDismiss={vi.fn()} onApplied={vi.fn()}/>);
  await selectFile(user);await user.click(screen.getByRole("button",{name:"预览导入"}));
  await user.click(await screen.findByRole("combobox",{name:"入口 DTS"}));await user.click(screen.getByRole("option",{name:"board.dts"}));
  await user.click(screen.getByRole("checkbox",{name:"覆盖文件 first.dtsi"}));await user.click(screen.getByRole("checkbox",{name:"覆盖文件 last.dtsi"}));
  expect(screen.getAllByText("last.dtsi",{exact:true})).toHaveLength(1);
  await user.click(screen.getByRole("button",{name:"预览导入"}));
  expect(await screen.findByRole("button",{name:"确认导入"})).toBeDisabled();
  expect(client.preview.mock.calls[1]?.[1]).toMatchObject({ownership:"private",sourceConfiguration:{entryFile:"board.dts",overlayOrder:["first.dtsi","last.dtsi"]}});
  await user.click(screen.getByRole("button",{name:"上移 last.dtsi"}));
  expect(screen.queryByRole("button",{name:"确认导入"})).not.toBeInTheDocument();
  expect(screen.getByRole("textbox",{name:"配置名称"})).toHaveValue("Imported");
});
const result:ConfigSetImportPreview={proofToken:"a".repeat(64),name:"Imported",ownership:"reuse",entryFile:"boards/original/board.dts",
  members:[{sourceName:"boards/original/board.dts",format:"dts",ownership:"private"}],sharedVersions:[],nodeCount:2,diagnostics:[]};
async function selectFile(user:ReturnType<typeof userEvent.setup>) {
  const file=new File(["archive"],"Imported-export.zip",{type:"application/zip"});
  Object.defineProperty(file,"arrayBuffer",{value:async()=>new TextEncoder().encode("archive").buffer});
  await user.upload(screen.getByLabelText("配置包"),file);
  await waitFor(()=>expect(screen.getByRole("button",{name:"预览导入"})).toBeEnabled());
}

it("uses one preview/confirm flow and preserves inputs on a recoverable failure",async()=>{
  const user=userEvent.setup(),onApplied=vi.fn();
  const client={preview:vi.fn().mockResolvedValue(result),apply:vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue({configSetId:"new",configRevisionId:"revision",fileIds:["fresh"],ownership:"reuse" as const})};
  render(<WorkbenchPackageImportDialog projectId="project" client={client} onDismiss={vi.fn()} onApplied={onApplied}/>);
  await selectFile(user);await user.click(screen.getByRole("button",{name:"预览导入"}));
  expect(await screen.findByLabelText("配置导入预览")).toHaveTextContent("boards/original/board.dts");
  await user.type(screen.getByRole("textbox",{name:"导入原因"}),"Reproduce original sources");
  await user.click(screen.getByRole("button",{name:"确认导入"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("未能确认导入结果，请重试同一操作");
  expect(screen.getByRole("textbox",{name:"导入原因"})).toHaveValue("Reproduce original sources");
  await user.click(screen.getByRole("button",{name:"重试同一操作"}));
  await waitFor(()=>expect(onApplied).toHaveBeenCalledOnce());
  expect(client.apply.mock.calls[0]).toEqual(client.apply.mock.calls[1]);
});

it("immediately invalidates old proof and ignores a late response after changing ownership",async()=>{
  const user=userEvent.setup();let resolve!:(value:ConfigSetImportPreview)=>void;
  const client={preview:vi.fn(()=>new Promise<ConfigSetImportPreview>(done=>{resolve=done;})),apply:vi.fn()};
  render(<WorkbenchPackageImportDialog projectId="project" client={client} onDismiss={vi.fn()} onApplied={vi.fn()}/>);
  await selectFile(user);await user.click(screen.getByRole("button",{name:"预览导入"}));
  await user.click(screen.getByRole("combobox",{name:"源码归属"}));await user.click(screen.getByRole("option",{name:"全部作为项目私有源码"}));
  resolve(result);
  await waitFor(()=>expect(screen.getByRole("button",{name:"预览导入"})).toBeEnabled());
  expect(screen.queryByRole("button",{name:"确认导入"})).not.toBeInTheDocument();
  expect(screen.queryByLabelText("配置导入预览")).not.toBeInTheDocument();
  expect(screen.getByRole("textbox",{name:"配置名称"})).toHaveValue("Imported");
});

it("retries the committed operation when refreshing the new configuration fails",async()=>{
  const user=userEvent.setup(),onApplied=vi.fn().mockRejectedValueOnce(new Error("Readback unavailable")).mockResolvedValue(undefined);
  const client={preview:vi.fn().mockResolvedValue(result),apply:vi.fn().mockResolvedValue({configSetId:"new",configRevisionId:"revision",fileIds:["fresh"],ownership:"reuse" as const})};
  render(<WorkbenchPackageImportDialog projectId="project" client={client} onDismiss={vi.fn()} onApplied={onApplied}/>);
  await selectFile(user);await user.click(screen.getByRole("button",{name:"预览导入"}));
  await user.type(await screen.findByRole("textbox",{name:"导入原因"}),"Preserve exact source inputs");
  await user.click(screen.getByRole("button",{name:"确认导入"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("输入已保留");
  expect(screen.getByRole("alert")).toHaveTextContent("未能确认导入结果");
  await user.click(screen.getByRole("button",{name:"重试同一操作"}));
  await waitFor(()=>expect(onApplied).toHaveBeenCalledTimes(2));
  expect(client.apply.mock.calls[0]).toEqual(client.apply.mock.calls[1]);
});

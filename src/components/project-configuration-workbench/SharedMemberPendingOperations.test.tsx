import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { SharedMemberPendingOperations } from "./SharedMemberPendingOperations";

const pending={id:"intent",clientMutationId:"mutation",projectId:"project",projectName:"项目甲",configSetId:"config",configSetName:"default",status:"pending" as const};

it("requires an explicit stop and reports an already-applied operation accurately",async()=>{
  const user=userEvent.setup(),applied={...pending,status:"applied" as const};
  const client={register:vi.fn(),list:vi.fn(async()=>({items:[pending],total:1})),stop:vi.fn(async()=>applied),acknowledge:vi.fn(async()=>applied)};
  render(<SharedMemberPendingOperations client={client} scope="user-a:org-a" refresh={0} onResolved={vi.fn()}/>);
  await user.click(await screen.findByRole("button",{name:"核对"}));expect(client.stop).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button",{name:"确认停止"}));expect(client.stop).toHaveBeenCalledOnce();
  expect(await screen.findByText("操作已应用。")).toBeVisible();await user.click(screen.getByRole("button",{name:"知道了"}));expect(client.acknowledge).toHaveBeenCalledWith(applied);
});

it("never presents the prior user's late results or actions after scope changes",async()=>{
  let complete!:(value:{items:typeof pending[];total:number})=>void;
  const client={register:vi.fn(),list:vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;})).mockResolvedValue({items:[],total:0}),stop:vi.fn(),acknowledge:vi.fn()};
  const view=render(<SharedMemberPendingOperations client={client} scope="user-a:org-a" refresh={0} onResolved={vi.fn()}/>);
  view.rerender(<SharedMemberPendingOperations client={client} scope="user-b:org-a" refresh={0} onResolved={vi.fn()}/>);
  await act(async()=>complete({items:[pending],total:1}));expect(screen.queryByText("项目甲")).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"核对"})).not.toBeInTheDocument();
});

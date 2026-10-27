import type { ReactNode } from "react";
import { SearchField } from "@/components/common/SearchField";
import { SectionSkeleton } from "@/components/common/SectionState";
import { NavigatorWorkbench } from "@/components/layout/NavigatorWorkbench";
import "./project-parameters-loading.css";

/** Keep the same workbench frame while either projects or topology are loading. */
export function ProjectParametersLoading({
  message = "正在加载项目参数…",
  notice,
}: { message?: string; notice?: ReactNode }) {
  return (
    <section className="dts-parameter-workbench project-parameters-loading" aria-label="DTS 参数工作台" aria-busy="true">
      <NavigatorWorkbench pageKey="parameters" navigatorLabel="模块导航" resizableNavigator
        toolbar={<label className="dts-parameter-workbench__search">
          <span>搜索参数</span>
          <SearchField value="" onValueChange={() => undefined} ariaLabel="搜索 DTS 参数"
            placeholder="参数名、模块、器件、路径或值" disabled loading />
        </label>}
        context={<div className="parameter-workbench-context"><div><span>正在加载项目参数…</span></div></div>}
        navigator={<div aria-hidden="true"><SectionSkeleton label="正在加载模块导航…" /></div>}
        notice={notice}
        taskLabel="DTS 参数列表" taskClassName="dts-workbench-list"
        taskState={{ kind: "loading", message }} />
    </section>
  );
}

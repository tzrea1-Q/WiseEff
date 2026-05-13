import { useCallback, useEffect, useRef, useState } from "react";

type PreviewKey = "parameters" | "logs" | "debugging";

type TabConfig = {
  key: PreviewKey;
  label: string;
  headline: string;
  meta: string;
  previewRows: Array<[string, string, string]>;
  features: Array<{ title: string; text: string }>;
};

const tabs: TabConfig[] = [
  {
    key: "parameters",
    label: "参数管理",
    headline: "参数目录",
    meta: "统一口径",
    previewRows: [
      ["业务项目", "共享参数", "独立读取"],
      ["变更记录", "差异留痕", "可回滚"],
      ["审阅状态", "待确认", "可追溯"]
    ],
    features: [
      { title: "全量参数与全项目覆盖。", text: "覆盖全部业务参数与项目范围，统一检索、对比和审阅入口。" },
      { title: "Agent 参数建议。", text: "Agent 基于上下文生成候选参数，人负责确认、审阅和下发。" },
      { title: "版本化配置。", text: "每次变更记录目标、来源、差异和回滚入口。" },
      { title: "证据绑定。", text: "参数变更可挂接日志、调试记录与 PRQ 审阅。" }
    ]
  },
  {
    key: "debugging",
    label: "调试平台",
    headline: "调试场景",
    meta: "在线连接",
    previewRows: [
      ["当前状态", "已连接", "快照已保留"],
      ["目标动作", "等待确认", "人工下发"],
      ["回滚入口", "已准备", "可撤回"]
    ],
    features: [
      { title: "调试目标进入。", text: "从参数变更或日志证据直接进入对应调试场景。" },
      { title: "多步 Workflow。", text: "把假设、参数建议、验证结果和确认动作串成路径。" },
      { title: "Agent 协同。", text: "Agent 给出候选操作，人负责确认是否下发。" },
      { title: "回滚准备。", text: "危险操作前保留原值、目标值和撤回说明。" }
    ]
  },
  {
    key: "logs",
    label: "日志分析",
    headline: "证据链路",
    meta: "异常事件",
    previewRows: [
      ["阶段 1", "上传日志文件", "可审阅"],
      ["阶段 2", "命中异常片段", "待确认"],
      ["阶段 3", "关联参数与 PRQ 草稿", "可追溯"]
    ],
    features: [
      { title: "日志入链。", text: "围绕异常事件和关键证据组织可审阅链路。" },
      { title: "上下文聚合。", text: "按设备、项目、参数和 Workflow 节点还原事件现场。" },
      { title: "异常定位。", text: "Agent 标注高风险片段，人工确认后进入后续调试。" },
      { title: "查询留痕。", text: "关键筛选条件、命中记录和导出动作进入审计链。" }
    ]
  }
];

const AUTO_INTERVAL = 6000;

export function PlatformFlowSection() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeTab = tabs[activeIndex];

  const clearTimers = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (progressRef.current) clearInterval(progressRef.current);
    timerRef.current = null;
    progressRef.current = null;
  }, []);

  const startAutoRotation = useCallback(() => {
    clearTimers();
    setProgress(0);
    const step = 50;
    progressRef.current = setInterval(() => {
      setProgress((p) => Math.min(p + step / AUTO_INTERVAL, 1));
    }, step);
    timerRef.current = setInterval(() => {
      setActiveIndex((i) => (i + 1) % tabs.length);
      setProgress(0);
    }, AUTO_INTERVAL);
  }, [clearTimers]);

  useEffect(() => {
    if (!isPaused) startAutoRotation();
    return clearTimers;
  }, [isPaused, activeIndex, startAutoRotation, clearTimers]);

  const selectTab = (nextIndex: number, shouldFocus = false) => {
    const normalizedIndex = (nextIndex + tabs.length) % tabs.length;
    setActiveIndex(normalizedIndex);
    setIsPaused(true);
    setTimeout(() => setIsPaused(false), AUTO_INTERVAL * 2);

    if (shouldFocus) {
      window.requestAnimationFrame(() => tabRefs.current[normalizedIndex]?.focus());
    }
  };

  return (
    <section className="platform-flow-section" id="platform-flow" aria-labelledby="platform-flow-title">
      <div className="linear-container">
        <div className="platform-flow-head">
          <h2 id="platform-flow-title">一条可审阅工作流，三种场景接入</h2>
          <p>把参数、日志和设备调试压缩进同一个可核对视图，保留 Agent 辅助与人工确认的边界。</p>
        </div>
        <div
          className="platform-flow-tablist"
          role="tablist"
          aria-label="WiseEff 工作流场景"
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
        >
          {tabs.map((tab, index) => (
            <button
              type="button"
              key={tab.key}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              className={index === activeIndex ? "platform-flow-tab active" : "platform-flow-tab"}
              id={`platform-flow-tab-${tab.key}`}
              role="tab"
              aria-selected={index === activeIndex}
              aria-controls={`platform-flow-panel-${tab.key}`}
              tabIndex={index === activeIndex ? 0 : -1}
              onClick={() => selectTab(index)}
              onKeyDown={(event) => {
                const focusedIndex = index;

                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  selectTab(focusedIndex + 1, true);
                }

                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  selectTab(focusedIndex - 1, true);
                }
              }}
            >
              {tab.label}
              {index === activeIndex && (
                <span
                  className="platform-flow-tab-progress"
                  style={{ transform: `scaleX(${progress})` }}
                />
              )}
            </button>
          ))}
        </div>
        <div
          className="platform-flow-panel"
          key={activeTab.key}
          id={`platform-flow-panel-${activeTab.key}`}
          role="tabpanel"
          aria-labelledby={`platform-flow-tab-${activeTab.key}`}
        >
          <div className="platform-flow-preview">
            <div className="platform-flow-preview-head">
              <span>{activeTab.headline}</span>
              <strong>{activeTab.meta}</strong>
            </div>
            {activeTab.previewRows.map(([label, value, detail]) => (
              <div className="platform-flow-preview-row" key={`${label}-${value}`}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{detail}</small>
              </div>
            ))}
          </div>
          <ul className="platform-flow-features">
            {activeTab.features.map((feature) => (
              <li key={feature.title}>
                <span className="platform-flow-feature-title">{feature.title}</span>
                {feature.text}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

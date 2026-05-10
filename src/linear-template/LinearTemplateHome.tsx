import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { WiseEffIcon } from "../components/WiseEffIcon";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import "./linear-template.css";

const navItems = [
  { label: "参数管理", href: "/parameter-home" },
  { label: "日志分析", href: "/logs" },
  { label: "参数调试", href: "/debugging" }
] as const;

const footerColumns = [
  {
    title: "Platform",
    links: [
      { label: "参数管理", href: "#platform" },
      { label: "日志分析", href: "#workflow" },
      { label: "参数调试", href: "#scenarios" }
    ]
  },
  {
    title: "Workflow",
    links: [
      { label: "目标进入", href: "#agent" },
      { label: "证据链", href: "#workflow" },
      { label: "人工确认", href: "#scenarios" }
    ]
  },
  {
    title: "Scope",
    links: [
      { label: "当前数据", href: "#platform" },
      { label: "模拟边界", href: "#scenarios" }
    ]
  },
  {
    title: "Access",
    links: [
      { label: "进入工作台", href: "/parameter-home" },
      { label: "查看配置", href: "/parameter-admin" },
      { label: "演示路线", href: "#scenarios" }
    ]
  }
] as const;

type Feature = {
  title: string;
  text: string;
};

type ProductSectionProps = {
  id?: string;
  color: string;
  colorDark: string;
  title: string;
  preview: "parameters" | "logs" | "debugging";
  text: string;
  features: Feature[];
};

type HeroStageSlide = {
  id: string;
  tabLabel: string;
  rails: string[];
  activeRail: number;
  toolbarContext: string;
  toolbarStatus: string;
  kicker: string;
  headline: string;
  description: string;
  evidence: Array<{ label: string; value: string }>;
  boundaryTitle: string;
  boundaryText: string;
};

const heroStageSlides: HeroStageSlide[] = [
  {
    id: "parameters",
    tabLabel: "参数管理",
    rails: ["Goal", "Parameters", "Logs", "Debugging", "Review"],
    activeRail: 0,
    toolbarContext: "Aurora / Charging Policy",
    toolbarStatus: "PRQ-9102",
    kicker: "Goal",
    headline: "把参数差异变成可审阅变更",
    description: "Agent 已定位相关参数、日志证据和调试上下文，正在准备可审阅的变更草稿。",
    evidence: [
      { label: "参数", value: "fast_charge_current_limit_ma" },
      { label: "日志", value: "battery_pack_temp=46.8C" },
      { label: "审阅", value: "PRQ-9102 待审阅" }
    ],
    boundaryTitle: "可代办，但不越权",
    boundaryText: "Agent 可以检索、解释、填写、串联上下文并准备推送草稿；提交、下发、合并仍等待人工确认。"
  },
  {
    id: "logs",
    tabLabel: "日志分析",
    rails: ["Upload", "Parse", "Match", "Reason", "Report"],
    activeRail: 2,
    toolbarContext: "charging_thermal_trace_20260504.log",
    toolbarStatus: "ANL-2405",
    kicker: "Evidence",
    headline: "把异常日志变成可追溯证据链",
    description: "Agent 正在聚合命中片段、筛选条件和关联参数，让专家看到结论来自哪里。",
    evidence: [
      { label: "原始信号", value: "CHG_THERMAL / WARN" },
      { label: "命中片段", value: "battery_pack_temp=46.8C" },
      { label: "输出", value: "根因推断草稿" }
    ],
    boundaryTitle: "给判断，也给来源",
    boundaryText: "Agent 可以解析日志、标注模式、生成排查清单；结论采纳、报告发布和后续动作仍保留审阅。"
  },
  {
    id: "debugging",
    tabLabel: "参数调试",
    rails: ["Device", "Snapshot", "Tune", "Push", "Rollback"],
    activeRail: 2,
    toolbarContext: "ChargeLab_X01 / BatteryBench_07",
    toolbarStatus: "待确认下发",
    kicker: "Debugging",
    headline: "把现场调参变成受控执行流程",
    description: "Agent 根据设备、固件和参数范围准备目标值，工作台保留确认、撤回和回滚入口。",
    evidence: [
      { label: "样机", value: "ChargeLab_X01 已连接" },
      { label: "参数", value: "charge_voltage_limit_mv" },
      { label: "保护", value: "保留原值快照" }
    ],
    boundaryTitle: "能准备，不替你下发",
    boundaryText: "Agent 可以推荐调试值、检查风险和准备回滚说明；真正改变设备状态的动作必须由工程师确认。"
  }
];

const parameterFeatures: Feature[] = [
  { title: "共享参数目录。", text: "Aurora、Nebula、Atlas 可独立读取同一业务参数。" },
  { title: "实时调参。", text: "fast_charge_current_limit_ma 等关键参数在下发前保留确认。" },
  { title: "版本化配置。", text: "每次变更记录目标、来源、差异和回滚入口。" },
  { title: "平台隔离。", text: "跨项目复用参数定义，但运行态取值互不污染。" },
  { title: "状态可见。", text: "工作台显示草稿、待确认、已生效与回滚状态。" },
  { title: "证据绑定。", text: "参数变更可挂接日志、调试记录与 PRQ 审阅。" }
];

const logFeatures: Feature[] = [
  { title: "日志入链。", text: "围绕 battery_pack_temp=46.8C 等信号组织可审阅证据。" },
  { title: "上下文聚合。", text: "按设备、项目、参数和 Workflow 节点还原事件现场。" },
  { title: "异常定位。", text: "Agent 标注高风险片段，人工确认后进入后续调试。" },
  { title: "跨平台对照。", text: "Aurora、Nebula、Atlas 日志用统一字段比较差异。" },
  { title: "查询留痕。", text: "关键筛选条件、命中记录和导出动作进入审计链。" },
  { title: "演示数据边界。", text: "仅展示当前原型内置样例，不伪造客户结果。" }
];

const debuggingFeatures: Feature[] = [
  { title: "调试目标进入。", text: "从参数或日志直接进入 ChargeLab_X01 场景。" },
  { title: "多步 Workflow。", text: "把假设、参数建议、验证结果和确认动作串成路径。" },
  { title: "Agent 协同。", text: "Agent 给出候选操作，人负责确认是否下发。" },
  { title: "证据回填。", text: "每个调试步骤可回连日志片段和参数快照。" },
  { title: "边界透明。", text: "当前原型模拟调试链路，不宣称真实自动闭环。" },
  { title: "回滚准备。", text: "危险操作前保留原值、目标值和撤回说明。" }
];

export function LinearTemplateHome() {
  return (
    <div className="linear-template-home light-homepage" data-theme="light">
      <TemplateHeader />
      <main className="linear-page-gradient" aria-label="WiseEff homepage">
        <section className="linear-hero-wrap">
          <Container>
            <Hero />
          </Container>
        </section>
        <StarsDivider />
        <UnlikeAnyTool />
        <ProductSection
          id="platform"
          color="194,97,254"
          colorDark="53,42,79"
          title="参数流转，从查询到审阅"
          preview="parameters"
          text="把差异、建议和审阅状态放到同一条参数链路里。"
          features={parameterFeatures}
        />
        <ProductSection
          id="workflow"
          color="40,87,255"
          colorDark="48,58,117"
          title="日志分析，不只给结论"
          preview="logs"
          text="让每个结论都能回到日志片段、上下文和触发点。"
          features={logFeatures}
        />
        <ProductSection
          id="scenarios"
          color="0,225,244"
          colorDark="31,49,64"
          title="调试动作，保留控制权"
          preview="debugging"
          text="让 Agent 准备调试路径，真正下发仍等待人工确认。"
          features={debuggingFeatures}
        />
      </main>
      <TemplateFooter />
    </div>
  );
}

function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`linear-container ${className}`.trim()}>{children}</div>;
}

function TemplateHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("linear-template-menu-open", menuOpen);
    return () => {
      document.documentElement.classList.remove("linear-template-menu-open");
    };
  }, [menuOpen]);

  useEffect(() => {
    const closeMenu = () => setMenuOpen(false);

    window.addEventListener("orientationchange", closeMenu);
    window.addEventListener("resize", closeMenu);

    return () => {
      window.removeEventListener("orientationchange", closeMenu);
      window.removeEventListener("resize", closeMenu);
    };
  }, []);

  return (
    <header className="linear-header">
      <Container className="linear-header-inner">
        <a className="linear-logo-link" href="#" aria-label="WiseEff home">
          <LinearLogo />
          <span>WiseEff</span>
        </a>
        <nav className={menuOpen ? "linear-nav open" : "linear-nav"} aria-label="WiseEff homepage navigation">
          <ul>
            {navItems.map((item) => (
              <li key={item.href}>
                <a href={item.href}>{item.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="linear-header-actions">
          <Button asChild className="linear-login" variant="link">
            <a href="#scenarios">查看演示</a>
          </Button>
          <Button asChild className="linear-button linear-button-small">
            <a href="/parameter-home" aria-label="进入 WiseEff 工作台">进入工作台</a>
          </Button>
        </div>
        <button
          className="linear-menu-button"
          type="button"
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span />
          <span />
        </button>
      </Container>
    </header>
  );
}

function Hero() {
  return (
    <div className="linear-hero">
      <h1 className="linear-fade-item delay-1">让业务流程更智能更高效</h1>
      <p className="linear-hero-subtitle linear-fade-item delay-2">
        WiseEff 把参数管理、日志分析、设备调试和审阅治理连接到同一平台。
        <br /> Agent 辅助检索、分析、填表和流转，关键变更保留确认、权限和审计。
      </p>
      <div className="linear-hero-actions linear-fade-item delay-3">
        <Button asChild className="linear-button linear-button-large">
          <a href="/parameter-home">进入工作台</a>
        </Button>
        <Button asChild className="linear-button linear-button-large secondary" variant="outline">
          <a href="#platform">查看当前能力</a>
        </Button>
      </div>
      <WiseEffHeroStage />
    </div>
  );
}

function WiseEffHeroStage() {
  const [activeSlide, setActiveSlide] = useState(0);
  const [slideDirection, setSlideDirection] = useState<"next" | "prev">("next");
  const [isAutoRotationPaused, setIsAutoRotationPaused] = useState(false);
  const slide = heroStageSlides[activeSlide];

  const goToSlide = useCallback((direction: "next" | "prev") => {
    setSlideDirection(direction);
    setActiveSlide((current) => {
      const offset = direction === "next" ? 1 : -1;
      return (current + offset + heroStageSlides.length) % heroStageSlides.length;
    });
  }, []);

  const handleManualSlide = (direction: "next" | "prev") => {
    setIsAutoRotationPaused(true);
    goToSlide(direction);
  };

  useEffect(() => {
    if (isAutoRotationPaused) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      goToSlide("next");
    }, 4800);

    return () => window.clearInterval(intervalId);
  }, [goToSlide, isAutoRotationPaused]);

  return (
    <div className="linear-hero-image-shell wiseeff-hero-stage" aria-label="WiseEff product application carousel">
      <div className="linear-hero-glow" />
      <div className="linear-flow-lines" aria-hidden="true">
        <span className="horizontal a" />
        <span className="vertical b" />
        <span className="horizontal c" />
        <span className="vertical d" />
      </div>
      <svg className="linear-sketch-lines" width="100%" viewBox="0 0 1499 778" fill="none" aria-hidden="true">
        <path pathLength="1" d="M1500 72L220 72" />
        <path pathLength="1" d="M1500 128L220 128" />
        <path pathLength="1" d="M1500 189L220 189" />
        <path pathLength="1" d="M220 777L220 1" />
        <path pathLength="1" d="M538 777L538 128" />
      </svg>
      <button
        type="button"
        className="wiseeff-stage-arrow wiseeff-stage-arrow-prev"
        aria-label="上一项 WiseEff 应用展示"
        onClick={() => handleManualSlide("prev")}
      >
        <span aria-hidden="true">‹</span>
      </button>
      <button
        type="button"
        className="wiseeff-stage-arrow wiseeff-stage-arrow-next"
        aria-label="下一项 WiseEff 应用展示"
        onClick={() => handleManualSlide("next")}
      >
        <span aria-hidden="true">›</span>
      </button>
      <div key={slide.id} className={`wiseeff-stage-frame slide-${slideDirection}`}>
        <aside className="wiseeff-stage-rail" aria-label="WiseEff workflow rail">
          {slide.rails.map((rail, index) => (
            <div key={rail} className={index === slide.activeRail ? "active" : ""}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {rail}
            </div>
          ))}
        </aside>
        <div className="wiseeff-stage-main">
          <div className="wiseeff-stage-toolbar">
            <span>{slide.toolbarContext}</span>
            <strong>{slide.toolbarStatus}</strong>
          </div>
          <div className="wiseeff-stage-content">
            <span className="wiseeff-stage-kicker">{slide.kicker}</span>
            <h2>{slide.headline}</h2>
            <p>{slide.description}</p>
            <div className="wiseeff-evidence-grid">
              {slide.evidence.map((item) => (
                <div key={item.value}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
        <aside className="wiseeff-boundary-panel">
          <span>Agent boundary</span>
          <h3>{slide.boundaryTitle}</h3>
          <p>{slide.boundaryText}</p>
        </aside>
      </div>
    </div>
  );
}

function StarsDivider() {
  return (
    <div className="linear-stars-divider" aria-hidden="true">
      <div className="linear-stars">
        {Array.from({ length: 42 }, (_, index) => (
          <span key={index} style={{ left: `${(index * 37) % 100}%`, top: `${(index * 53) % 100}%` }} />
        ))}
      </div>
    </div>
  );
}

function UnlikeAnyTool() {
  return (
    <section className="linear-unlike" id="agent">
      <Container>
        <div className="linear-section-heading">
          <h2>不是另一个后台系统</h2>
          <p>
            WiseEff 不是再堆一组页面，而是把目标、上下文、证据、动作和审批放进同一条可审计的工作流。
          </p>
        </div>
      </Container>
      <div className="linear-tool-grid" aria-label="WiseEff workflow qualities">
        <article className="linear-tool-card logo-light-card">
          <LogoLightMock />
          <h3>让 Agent 代办</h3>
          <p>Agent 辅助检索、解释、填写和准备草稿，危险动作保持人工确认。</p>
          <a className="linear-card-link" href="#platform">
            <span>当前能力</span>
            查看边界
            <strong>›</strong>
          </a>
        </article>
        <article className="linear-tool-card large command-card">
          <CommandMenuMock />
          <h3>把治理做进流程</h3>
          <p>PRQ 审阅、角色边界、确认动作和回滚说明跟着业务链路一起沉淀。</p>
        </article>
      </div>
    </section>
  );
}

function LogoLightMock() {
  return (
    <div className="linear-logo-light-mock" aria-hidden="true">
      <LinearLogo />
      <span />
      <span />
      <span />
    </div>
  );
}

function CommandMenuMock() {
  const rows = ["定位参数", "检索日志证据", "填写变更草稿", "准备 PRQ 审阅", "等待人工确认"];

  return (
    <div className="linear-command-menu-mock" aria-hidden="true">
      <div className="linear-command-input">描述目标...</div>
      {rows.map((row, index) => (
        <div key={row} className={index === 1 ? "active" : ""}>
          <span />
          {row}
          <kbd>⌘{index + 1}</kbd>
        </div>
      ))}
    </div>
  );
}

function ProductSection({ id, color, colorDark, title, preview, text, features }: ProductSectionProps) {
  return (
    <section
      id={id}
      className="linear-product-section"
      style={
        {
          "--feature-color": color,
          "--feature-color-dark": colorDark
        } as CSSProperties
      }
    >
      <Container className="linear-feature-main large">
        <h2>{title}</h2>
        <div className="linear-feature-image-frame">
          <WiseEffSectionPreview type={preview} />
        </div>
      </Container>
      <Container className="linear-feature-summary">
        <p>{text}</p>
        <Separator />
      </Container>
      <Container>
        <div className="linear-feature-grid">
          {features.map((feature, index) => (
            <div key={feature.title}>
              <FeatureIcon index={index} />
              <span>{feature.title}</span> {feature.text}
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

function WiseEffSectionPreview({ type }: { type: ProductSectionProps["preview"] }) {
  if (type === "parameters") {
    return (
      <div className="wiseeff-preview parameters">
        <PreviewHeader title="Parameter Matrix" meta="fast_charge_current_limit_ma" />
        {[
          ["Aurora", "3850 mA", "生产策略"],
          ["Nebula", "4200 mA", "研发策略"],
          ["Atlas", "3000 mA", "国际策略"]
        ].map(([project, value, detail]) => (
          <div key={project} className="wiseeff-preview-row">
            <span>{project}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
          </div>
        ))}
      </div>
    );
  }

  if (type === "logs") {
    return (
      <div className="wiseeff-preview logs">
        <PreviewHeader title="Evidence Chain" meta="battery_pack_temp=46.8C" />
        {["上传 charging_thermal_trace_20260504.log", "命中高温充电片段", "关联参数与 PRQ 草稿"].map((stage, index) => (
          <div key={stage} className="wiseeff-preview-row">
            <span>阶段 {index + 1}</span>
            <strong>{stage}</strong>
            <small>{index === 1 ? "soft_limit=45C" : "可审阅"}</small>
          </div>
        ))}
      </div>
    );
  }

  if (type === "debugging") {
    return (
      <div className="wiseeff-preview debugging">
        <PreviewHeader title="ChargeLab_X01" meta="connected" />
        <div className="wiseeff-preview-card-grid">
          {[
            ["当前值", "3850 mA"],
            ["目标值", "3200 mA"],
            ["状态", "等待确认"],
            ["回滚值", "3850 mA"]
          ].map(([label, value]) => (
            <div key={label} className="wiseeff-preview-card">
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

function PreviewHeader({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="wiseeff-preview-header">
      <span>{title}</span>
      <strong>{meta}</strong>
    </div>
  );
}

function FeatureIcon({ index }: { index: number }) {
  const shapes = ["M5 12h14", "M7 7h10v10H7z", "M6 9l4 4 8-8", "M4 6h16M4 12h16M4 18h10", "M12 5v14M5 12h14", "M8 8h8v8H8z"];

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={shapes[index % shapes.length]} />
    </svg>
  );
}

function TemplateFooter() {
  return (
    <footer className="linear-footer">
      <Container className="linear-footer-inner">
        <div className="linear-footer-brand">
          <div>
            <LinearLogo />
            <span>WiseEff · AI-driven workflow system</span>
          </div>
        </div>
        <div className="linear-footer-links">
          {footerColumns.map((column) => (
            <div key={column.title}>
              <h3>{column.title}</h3>
              <ul>
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a href={link.href} aria-label={link.label === "进入工作台" ? "进入 WiseEff 工作台" : undefined}>
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Container>
    </footer>
  );
}

function LinearLogo() {
  return <WiseEffIcon decorative className="linear-logo" />;
}

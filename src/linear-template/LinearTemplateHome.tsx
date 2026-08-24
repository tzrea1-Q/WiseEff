import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { WiseEffIcon } from "../components/WiseEffIcon";
import { PlatformFlowSection } from "./PlatformFlowSection";
import { SubAppEntryRow } from "./SubAppEntryRow";
import { handleSpaLinkClick } from "./spaLinkNavigation";
import { homepageHeroWorkflowPhrase, isWorkflowVisible, type WorkflowId } from "@/domain/workflowDiscovery";
import { AppFooter } from "@/components/common/AppFooter";
import { appFooterConfig } from "@/config/appFooterConfig";
import "./linear-template.css";

type OnNavigate = (path: string) => void;

const allNavItems: Array<{ label: string; href: string; workflowId: WorkflowId }> = [
  { label: "参数管理", href: "/parameter-home", workflowId: "parameter-management" },
  { label: "调试平台", href: "/node-debugging", workflowId: "debugging" },
  { label: "日志分析", href: "/logs", workflowId: "log-analysis" }
];

const navItems = allNavItems.filter((item) => isWorkflowVisible(item.workflowId));

const footerColumns = [
  {
    title: "平台",
    links: allNavItems.filter((item) => isWorkflowVisible(item.workflowId))
  },
  {
    title: "流程",
    links: [
      { label: "一条可审阅链路", href: "#platform-flow" },
      { label: "人工确认", href: "#platform-flow" }
    ]
  },
  {
    title: "范围",
    links: [{ label: "模拟边界", href: "#platform-flow" }]
  },
  {
    title: "访问",
    links: [
      { label: "进入工作台", href: "/parameter-home" },
      { label: "查看配置", href: "/parameter-admin" }
    ]
  }
];

export function LinearTemplateHome({
  onNavigate,
  onFeedback
}: {
  onNavigate?: OnNavigate;
  onFeedback: () => void;
}) {
  return (
    <div className="linear-template-home light-homepage" data-theme="light">
      <TemplateHeader onNavigate={onNavigate} />
      <main className="linear-page-gradient" aria-label="雷泽首页">
        <section className="linear-hero-wrap">
          <Container>
            <Hero onNavigate={onNavigate} />
          </Container>
        </section>
        <PlatformFlowSection />
      </main>
      <TemplateFooter onNavigate={onNavigate} onFeedback={onFeedback} />
    </div>
  );
}

function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`linear-container ${className}`.trim()}>{children}</div>;
}

function TemplateHeader({ onNavigate }: { onNavigate?: OnNavigate }) {
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
        <a className="linear-logo-link" href="#" aria-label="雷泽首页">
          <LinearLogo />
          <span>雷泽</span>
        </a>
        <nav className={menuOpen ? "linear-nav open" : "linear-nav"} aria-label="雷泽首页导航">
          <ul>
            {navItems.map((item) => (
              <li key={item.href}>
                <a href={item.href} onClick={(event) => handleSpaLinkClick(event, item.href, onNavigate)}>
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="linear-header-actions">
          <a className="linear-login" href="#platform-flow">
            查看演示
          </a>
          <a
            className="linear-button linear-button-small"
            href="/parameter-home"
            aria-label="打开雷泽工作台"
            onClick={(event) => handleSpaLinkClick(event, "/parameter-home", onNavigate)}
          >
            打开我的工作台
          </a>
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

function Hero({ onNavigate }: { onNavigate?: OnNavigate }) {
  return (
    <div className="linear-hero">
      <h1 className="linear-fade-item delay-1">让业务流程更智能、更高效、更可控</h1>
      <p className="linear-hero-subtitle linear-fade-item delay-2">
        雷泽把{homepageHeroWorkflowPhrase()}连接成一条可审阅工作流，
        <br />
        让 Agent 辅助检索、分析和流转，关键变更始终保留人工确认、权限和审计。
      </p>
      <SubAppEntryRow onNavigate={onNavigate} />
    </div>
  );
}

function TemplateFooter({
  onNavigate,
  onFeedback
}: {
  onNavigate?: OnNavigate;
  onFeedback: () => void;
}) {
  return (
    <footer className="linear-footer">
      <Container className="linear-footer-inner">
        <div className="linear-footer-brand">
          <div>
            <LinearLogo />
            <span>雷泽 · 工作流平台</span>
          </div>
        </div>
        <div className="linear-footer-links">
          {footerColumns.map((column) => (
            <div key={column.title}>
              <h3>{column.title}</h3>
              <ul>
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      aria-label={link.label === "进入工作台" ? "进入雷泽工作台" : undefined}
                      onClick={(event) => handleSpaLinkClick(event, link.href, onNavigate)}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Container>
      <Container>
        <AppFooter config={appFooterConfig} onFeedback={onFeedback} variant="homepage" />
      </Container>
    </footer>
  );
}

function LinearLogo() {
  return <WiseEffIcon decorative className="linear-logo" />;
}

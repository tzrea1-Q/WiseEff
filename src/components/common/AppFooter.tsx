import type { AppFooterConfig } from "@/config/appFooterConfig";
import { Button } from "@/components/ui/button";

type AppFooterProps = {
  config: AppFooterConfig;
  onFeedback: () => void;
  variant?: "application" | "homepage";
};

export function AppFooter({ config, onFeedback, variant = "application" }: AppFooterProps) {
  const Root = variant === "homepage" ? "div" : "footer";

  return (
    <Root
      className={variant === "homepage" ? "app-footer app-footer--homepage" : "app-footer"}
      aria-label={variant === "application" ? "页脚信息" : undefined}
    >
      <div className="app-footer__meta">
        <span>© {new Date().getFullYear()} {config.copyrightOwner}</span>
        <span>版本 {config.version}</span>
      </div>
      <div className="app-footer__actions">
        <Button size="xs" type="button" variant="ghost" onClick={onFeedback}>
          问题反馈
        </Button>
        {config.contact ? (
          <Button asChild size="xs" variant="ghost">
            <a
              href={config.contact.href}
              rel={config.contact.kind === "https" ? "noopener noreferrer" : undefined}
              target={config.contact.kind === "https" ? "_blank" : undefined}
            >
              联系我们
            </a>
          </Button>
        ) : null}
      </div>
    </Root>
  );
}

import {
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  CopilotChatView,
  CopilotModalHeader,
  useCopilotChatConfiguration
} from "@copilotkit/react-core/v2";
import { XiaozeChatToggleButton } from "./XiaozeChatToggleButton";
import { isXiaozePopupDesktop } from "./xiaozePopupLayout";
import {
  dimensionToCss,
  readXiaozePopupMotionDurations,
  type XiaozePopupMotionPhase
} from "./xiaozePopupMotion";
import { writeXiaozePopupOpenSession } from "./xiaozePopupOpenState";

const DEFAULT_POPUP_WIDTH = 420;
const DEFAULT_POPUP_HEIGHT = 680;
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function isVisibleFocusable(node: HTMLElement) {
  if (node.hasAttribute("hidden") || node.closest("[hidden],[inert]")) {
    return false;
  }
  const style = window.getComputedStyle(node);
  return style.display !== "none" && style.visibility !== "hidden";
}

function focusableWithin(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisibleFocusable);
}

function acquireMobileBackgroundInert(layer: HTMLElement) {
  const acquired: HTMLElement[] = [];
  let current: HTMLElement = layer;
  while (current.parentElement && current.parentElement !== document.body) {
    const parent = current.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (sibling instanceof HTMLElement && sibling !== current && !sibling.hasAttribute("inert")) {
        sibling.setAttribute("inert", "");
        acquired.push(sibling);
      }
    }
    current = parent;
  }
  return () => {
    for (const element of acquired) {
      element.removeAttribute("inert");
    }
  };
}

/**
 * The Xiaoze approval card (Radix AlertDialog) portals to <body>, outside the
 * popup container. Without this guard, a pointer-down or scrim click on the
 * approval card counts as "outside" and closes the chat, which abandons the
 * pending interrupt so it can never resolve. Treat anything inside the alert
 * dialog overlay/content as inside the popup.
 */
function isWithinApprovalCard(target: Node) {
  return target instanceof Element
    ? Boolean(target.closest("[data-slot='alert-dialog-content'], [data-slot='alert-dialog-overlay']"))
    : false;
}

export type XiaozePopupViewProps = {
  header?: ComponentProps<typeof CopilotModalHeader>;
  toggleButton?: ComponentProps<typeof XiaozeChatToggleButton>;
  width?: number | string;
  height?: number | string;
  clickOutsideToClose?: boolean;
  className?: string;
} & ComponentProps<typeof CopilotChatView>;

function renderHeaderSlot(header: XiaozePopupViewProps["header"]) {
  if (!header) {
    return <CopilotModalHeader />;
  }
  const { children, ...rest } = header;
  if (children) {
    return <CopilotModalHeader {...rest}>{children}</CopilotModalHeader>;
  }
  return <CopilotModalHeader {...rest} />;
}

function renderToggleSlot(toggleButton: XiaozePopupViewProps["toggleButton"]) {
  if (!toggleButton) {
    return <XiaozeChatToggleButton />;
  }
  return <XiaozeChatToggleButton {...toggleButton} />;
}

export function XiaozePopupView({
  header,
  toggleButton,
  width,
  height,
  clickOutsideToClose = true,
  className,
  ...chatProps
}: XiaozePopupViewProps) {
  const configuration = useCopilotChatConfiguration();
  const isPopupOpen = configuration?.isModalOpen ?? false;
  const setModalOpen = configuration?.setModalOpen;
  const labels = configuration?.labels;
  const modalTitle = labels?.modalHeaderTitle ?? "小泽";

  const layerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const [isMounted, setIsMounted] = useState(isPopupOpen);
  const [motion, setMotion] = useState<XiaozePopupMotionPhase>(isPopupOpen ? "visible" : "leaving");
  const [isDesktop, setIsDesktop] = useState(() => isXiaozePopupDesktop());
  const { openMs, closeMs } = readXiaozePopupMotionDurations();

  const requestClose = useCallback(() => {
    writeXiaozePopupOpenSession(false);
    setModalOpen?.(false);
  }, [setModalOpen]);

  useEffect(() => {
    const handleResize = () => setIsDesktop(isXiaozePopupDesktop());
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = isPopupOpen;

    if (isPopupOpen && !wasOpen) {
      setIsMounted(true);
      setMotion("entering");
      let frame = 0;
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => {
          setMotion("visible");
        });
      });
      return () => window.cancelAnimationFrame(frame);
    }

    if (!isPopupOpen && wasOpen) {
      setMotion("leaving");
      const timeout = window.setTimeout(() => {
        setIsMounted(false);
      }, closeMs);
      return () => window.clearTimeout(timeout);
    }

    if (isPopupOpen) {
      setIsMounted(true);
      setMotion("visible");
    }
  }, [closeMs, isPopupOpen]);

  useEffect(() => {
    if (!isPopupOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const activeElement = document.activeElement;
        if (
          isDesktop &&
          activeElement instanceof Node &&
          !containerRef.current?.contains(activeElement) &&
          !isWithinApprovalCard(activeElement)
        ) {
          return;
        }
        event.preventDefault();
        requestClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDesktop, isPopupOpen, requestClose]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!isPopupOpen || isDesktop || !layer) {
      return;
    }
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && !layer.contains(activeElement)) {
      restoreFocusRef.current = activeElement;
    }
    const releaseBackgroundInert = acquireMobileBackgroundInert(layer);
    containerRef.current?.focus({ preventScroll: true });
    return releaseBackgroundInert;
  }, [isDesktop, isMounted, isPopupOpen]);

  const trapMobileTab = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isDesktop || event.key !== "Tab") {
      return;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const focusables = focusableWithin(container);
    if (focusables.length === 0) {
      event.preventDefault();
      container.focus();
      return;
    }
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === container)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [isDesktop]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const activeElement = document.activeElement;

    if (isPopupOpen) {
      if (activeElement instanceof HTMLElement && !layer?.contains(activeElement)) {
        restoreFocusRef.current = activeElement;
      }
      return;
    }

    if (!layer?.contains(activeElement)) {
      restoreFocusRef.current = null;
      return;
    }

    const previousFocus = restoreFocusRef.current;
    const toggle = document.querySelector<HTMLElement>("[data-slot='chat-toggle-button']");
    const focusTarget =
      previousFocus && previousFocus !== document.body && previousFocus.isConnected && !layer.contains(previousFocus)
        ? previousFocus
        : toggle;
    focusTarget?.focus({ preventScroll: true });
    restoreFocusRef.current = null;
  }, [isPopupOpen]);

  useEffect(() => {
    if (!isPopupOpen) {
      return;
    }

    const focusTimer = window.setTimeout(() => {
      const container = containerRef.current;
      if (container && !container.contains(document.activeElement)) {
        container.focus({ preventScroll: true });
      }
    }, Math.min(openMs, 280));

    return () => window.clearTimeout(focusTimer);
  }, [isPopupOpen, openMs]);

  useEffect(() => {
    if (!isPopupOpen || !clickOutsideToClose || isDesktop) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (containerRef.current?.contains(target)) {
        return;
      }
      if (target instanceof Element && target.closest(".xiaoze-popup-scrim")) {
        return;
      }
      if (isWithinApprovalCard(target)) {
        return;
      }
      const toggle = document.querySelector("[data-slot='chat-toggle-button']");
      if (toggle?.contains(target)) {
        return;
      }
      requestClose();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [clickOutsideToClose, isDesktop, isPopupOpen, requestClose]);

  const popupStyle = useMemo(
    () =>
      ({
        "--copilot-popup-width": dimensionToCss(width, DEFAULT_POPUP_WIDTH),
        "--copilot-popup-height": dimensionToCss(height, DEFAULT_POPUP_HEIGHT),
        "--copilot-popup-max-width": "calc(100vw - 3rem)",
        "--copilot-popup-max-height": "calc(100dvh - 7.5rem)",
        "--xiaoze-popup-open-ms": `${openMs}ms`,
        "--xiaoze-popup-close-ms": `${closeMs}ms`
      }) as CSSProperties,
    [closeMs, height, openMs, width]
  );

  const headerElement = useMemo(() => renderHeaderSlot(header), [header]);
  const toggleButtonElement = useMemo(() => renderToggleSlot(toggleButton), [toggleButton]);

  return (
    <>
      {toggleButtonElement}
      {isMounted ? (
        <div
          ref={layerRef}
          className="xiaoze-popup-layer"
          data-motion={motion}
          data-presentation={isDesktop ? "modeless" : "modal"}
          data-testid="xiaoze-popup-layer"
          style={popupStyle}
        >
          {!isDesktop ? (
            <button
              type="button"
              className="xiaoze-popup-scrim"
              aria-hidden="true"
              tabIndex={-1}
              onClick={(event) => {
                if (clickOutsideToClose && !isWithinApprovalCard(event.target as Node)) {
                  requestClose();
                }
              }}
            />
          ) : null}
          <div
            ref={containerRef}
            tabIndex={-1}
            role={isPopupOpen ? "dialog" : undefined}
            aria-label={isPopupOpen ? modalTitle : undefined}
            aria-modal={isPopupOpen && !isDesktop ? "true" : undefined}
            aria-hidden={isPopupOpen ? undefined : "true"}
            inert={isPopupOpen ? undefined : true}
            data-testid="copilot-popup"
            data-copilot-popup=""
            data-motion={motion}
            className="copilotKitPopup copilotKitWindow xiaoze-popup-window"
            style={popupStyle}
            onKeyDown={trapMobileTab}
          >
            {headerElement}
            <div className="xiaoze-popup-window__body" data-popup-chat="">
              <CopilotChatView {...chatProps} className={["xiaoze-popup-chat", className].filter(Boolean).join(" ")} />
            </div>
            {isDesktop ? (
              <button
                type="button"
                className="xiaoze-popup-resize-handle"
                data-xiaoze-resize-handle=""
                aria-label="调整小泽窗口大小"
                title="拖动调整窗口大小；方向键微调，Shift 加速，Home 复位"
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

XiaozePopupView.WelcomeScreen = CopilotChatView.WelcomeScreen;

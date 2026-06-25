import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const STICK_THRESHOLD_PX = 72;

type UseXiaozeChatAutoScrollOptions = {
  enabled?: boolean;
};

function getDistanceFromBottom(scrollEl: HTMLElement) {
  return scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
}

export function useXiaozeChatAutoScroll(
  scrollRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  { enabled = true }: UseXiaozeChatAutoScrollOptions = {}
) {
  const pinnedRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const lastScrollHeightRef = useRef(0);
  const programmaticRef = useRef(false);
  const followFrameRef = useRef<number | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const stopFollowFrame = useCallback(() => {
    if (followFrameRef.current !== null) {
      cancelAnimationFrame(followFrameRef.current);
      followFrameRef.current = null;
    }
  }, []);

  const syncScrollButton = useCallback(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) {
      return;
    }
    const distanceFromBottom = getDistanceFromBottom(scrollEl);
    setShowScrollButton(!pinnedRef.current && distanceFromBottom > STICK_THRESHOLD_PX);
  }, [scrollRef]);

  const snapToBottom = useCallback(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) {
      return;
    }
    programmaticRef.current = true;
    scrollEl.scrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
    programmaticRef.current = false;
    lastScrollTopRef.current = scrollEl.scrollTop;
    lastScrollHeightRef.current = scrollEl.scrollHeight;
    syncScrollButton();
  }, [scrollRef, syncScrollButton]);

  const followContentGrowth = useCallback(() => {
    const scrollEl = scrollRef.current;
    if (!enabled || !scrollEl || !pinnedRef.current) {
      return;
    }

    const nextScrollHeight = scrollEl.scrollHeight;
    const heightDelta = nextScrollHeight - lastScrollHeightRef.current;
    const distanceFromBottom = getDistanceFromBottom(scrollEl);

    if (heightDelta > 0) {
      programmaticRef.current = true;
      scrollEl.scrollTop += heightDelta;
      programmaticRef.current = false;
      lastScrollTopRef.current = scrollEl.scrollTop;
    } else if (heightDelta < 0 || distanceFromBottom > 0.5) {
      snapToBottom();
    }

    lastScrollHeightRef.current = nextScrollHeight;
    syncScrollButton();
  }, [enabled, snapToBottom, syncScrollButton]);

  const scheduleFollowBottom = useCallback(() => {
    if (!enabled || !pinnedRef.current || followFrameRef.current !== null) {
      return;
    }
    followFrameRef.current = requestAnimationFrame(() => {
      followFrameRef.current = null;
      followContentGrowth();
    });
  }, [enabled, followContentGrowth]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const scrollEl = scrollRef.current;
      if (!scrollEl) {
        return;
      }
      pinnedRef.current = true;
      setShowScrollButton(false);
      stopFollowFrame();
      if (behavior === "auto") {
        snapToBottom();
        return;
      }
      scrollEl.scrollTo({
        top: scrollEl.scrollHeight,
        behavior
      });
      lastScrollTopRef.current = scrollEl.scrollTop;
      lastScrollHeightRef.current = scrollEl.scrollHeight;
    },
    [scrollRef, snapToBottom, stopFollowFrame]
  );

  useEffect(() => {
    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    if (!enabled || !scrollEl || !contentEl) {
      return;
    }

    lastScrollTopRef.current = scrollEl.scrollTop;
    lastScrollHeightRef.current = scrollEl.scrollHeight;
    syncScrollButton();

    const onScroll = () => {
      if (programmaticRef.current) {
        return;
      }

      const distanceFromBottom = getDistanceFromBottom(scrollEl);
      const scrolledUp = scrollEl.scrollTop < lastScrollTopRef.current - 2;

      if (scrolledUp && distanceFromBottom > STICK_THRESHOLD_PX) {
        pinnedRef.current = false;
      } else if (distanceFromBottom <= STICK_THRESHOLD_PX) {
        pinnedRef.current = true;
        lastScrollHeightRef.current = scrollEl.scrollHeight;
      }

      lastScrollTopRef.current = scrollEl.scrollTop;
      syncScrollButton();
    };

    scrollEl.addEventListener("scroll", onScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => {
      scheduleFollowBottom();
    });
    resizeObserver.observe(contentEl);

    const mutationObserver = new MutationObserver(() => {
      scheduleFollowBottom();
    });
    mutationObserver.observe(contentEl, {
      childList: true,
      subtree: true,
      characterData: true
    });

    const chatRoot = contentEl.closest("[data-copilot-running]");
    const runningObserver =
      chatRoot &&
      new MutationObserver(() => {
        if (chatRoot.getAttribute("data-copilot-running") === "true") {
          pinnedRef.current = true;
          scheduleFollowBottom();
          syncScrollButton();
        }
      });

    if (runningObserver && chatRoot) {
      runningObserver.observe(chatRoot, {
        attributes: true,
        attributeFilter: ["data-copilot-running"]
      });
      if (chatRoot.getAttribute("data-copilot-running") === "true") {
        pinnedRef.current = true;
        scheduleFollowBottom();
      }
    }

    return () => {
      scrollEl.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      runningObserver?.disconnect();
      stopFollowFrame();
    };
  }, [contentRef, enabled, scheduleFollowBottom, scrollRef, stopFollowFrame, syncScrollButton]);

  return {
    showScrollButton,
    scrollToBottom
  };
}

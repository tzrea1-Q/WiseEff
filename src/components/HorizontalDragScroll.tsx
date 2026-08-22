import { useEffect, useId, useRef, type ComponentPropsWithoutRef } from "react";
import { useHorizontalDragScroll } from "@/hooks/useHorizontalDragScroll";

type HorizontalDragScrollProps = ComponentPropsWithoutRef<"div"> & {
  /** Opt-in persistent visual affordance for wide scrollports. */
  visibleRail?: boolean;
};

/** Overflowed table/list scrollport with pointer-drag pan and an optional visible rail. */
export function HorizontalDragScroll({ visibleRail = false, ...props }: HorizontalDragScrollProps) {
  if (!visibleRail) {
    return <HorizontalDragScrollport {...props} />;
  }
  return <HorizontalDragScrollWithRail {...props} />;
}

/** Preserve the legacy consumer path exactly: one ref, one drag-scroll hook, one div. */
function HorizontalDragScrollport(props: ComponentPropsWithoutRef<"div">) {
  const ref = useRef<HTMLDivElement>(null);
  useHorizontalDragScroll(ref);
  return <div ref={ref} {...props} />;
}

function HorizontalDragScrollWithRail(props: ComponentPropsWithoutRef<"div">) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const generatedId = useId();
  const scrollportId = props.id ?? `horizontal-drag-scroll-${generatedId.replace(/[^a-zA-Z0-9_-]/gu, "")}`;
  useHorizontalDragScroll(scrollRef);

  useEffect(() => {
    const scroller = scrollRef.current;
    const rail = railRef.current;
    const thumb = thumbRef.current;
    if (!scroller || !rail || !thumb) {
      return undefined;
    }

    const resolveThumbMinWidth = () => {
      const parsed = Number.parseFloat(getComputedStyle(thumb).minWidth);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    };
    const geometry = () => {
      const view = scroller.clientWidth;
      const total = scroller.scrollWidth;
      const maxScroll = Math.max(total - view, 0);
      const track = Math.max(rail.clientWidth, 1);
      const thumbWidth = total > 0
        ? Math.max(Math.round((view / total) * track), resolveThumbMinWidth())
        : track;
      return {
        maxScroll,
        thumbWidth: Math.min(thumbWidth, track),
        maxThumbLeft: Math.max(track - Math.min(thumbWidth, track), 0)
      };
    };

    const updateThumb = () => {
      const { maxScroll, thumbWidth, maxThumbLeft } = geometry();
      rail.hidden = maxScroll <= 1;
      rail.tabIndex = rail.hidden ? -1 : 0;
      rail.setAttribute("aria-valuemax", String(Math.round(maxScroll)));
      rail.setAttribute(
        "aria-valuenow",
        String(Math.round(Math.min(Math.max(scroller.scrollLeft, 0), maxScroll)))
      );
      if (rail.hidden) {
        return;
      }
      const thumbLeft = maxScroll === 0 ? 0 : Math.round((scroller.scrollLeft / maxScroll) * maxThumbLeft);
      thumb.style.width = `${thumbWidth}px`;
      thumb.style.transform = `translateX(${thumbLeft}px)`;
    };

    let dragging = false;
    let dragStartX = 0;
    let dragStartScroll = 0;

    const onThumbPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      dragging = true;
      dragStartX = event.clientX;
      dragStartScroll = scroller.scrollLeft;
      thumb.setPointerCapture(event.pointerId);
    };
    const onThumbPointerMove = (event: PointerEvent) => {
      if (!dragging) {
        return;
      }
      const { maxScroll, maxThumbLeft } = geometry();
      if (maxThumbLeft === 0 || maxScroll === 0) {
        return;
      }
      scroller.scrollLeft = dragStartScroll + ((event.clientX - dragStartX) / maxThumbLeft) * maxScroll;
      updateThumb();
    };
    const onThumbPointerUp = (event: PointerEvent) => {
      if (!dragging) {
        return;
      }
      dragging = false;
      if (thumb.hasPointerCapture(event.pointerId)) {
        thumb.releasePointerCapture(event.pointerId);
      }
    };
    const onTrackPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || event.target === thumb || thumb.contains(event.target as Node)) {
        return;
      }
      const { maxScroll, thumbWidth, maxThumbLeft } = geometry();
      if (maxThumbLeft === 0 || maxScroll === 0) {
        return;
      }
      const clickLeft = event.clientX - rail.getBoundingClientRect().left - thumbWidth / 2;
      scroller.scrollLeft = (Math.min(Math.max(clickLeft, 0), maxThumbLeft) / maxThumbLeft) * maxScroll;
      updateThumb();
    };
    const onRailKeyDown = (event: KeyboardEvent) => {
      const { maxScroll } = geometry();
      if (maxScroll <= 1) {
        return;
      }
      const lineStep = Math.max(Math.round(scroller.clientWidth / 5), 1);
      let nextScrollLeft: number | null = null;
      switch (event.key) {
        case "ArrowLeft":
          nextScrollLeft = scroller.scrollLeft - lineStep;
          break;
        case "ArrowRight":
          nextScrollLeft = scroller.scrollLeft + lineStep;
          break;
        case "PageUp":
          nextScrollLeft = scroller.scrollLeft - scroller.clientWidth;
          break;
        case "PageDown":
          nextScrollLeft = scroller.scrollLeft + scroller.clientWidth;
          break;
        case "Home":
          nextScrollLeft = 0;
          break;
        case "End":
          nextScrollLeft = maxScroll;
          break;
        default:
          return;
      }
      event.preventDefault();
      scroller.scrollLeft = Math.min(Math.max(nextScrollLeft, 0), maxScroll);
      updateThumb();
    };

    scroller.addEventListener("scroll", updateThumb, { passive: true });
    rail.addEventListener("pointerdown", onTrackPointerDown);
    rail.addEventListener("keydown", onRailKeyDown);
    thumb.addEventListener("pointerdown", onThumbPointerDown);
    thumb.addEventListener("pointermove", onThumbPointerMove);
    thumb.addEventListener("pointerup", onThumbPointerUp);
    thumb.addEventListener("pointercancel", onThumbPointerUp);
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(updateThumb) : null;
    resizeObserver?.observe(scroller);
    resizeObserver?.observe(rail);
    if (scroller.firstElementChild) {
      resizeObserver?.observe(scroller.firstElementChild);
    }
    updateThumb();

    return () => {
      scroller.removeEventListener("scroll", updateThumb);
      rail.removeEventListener("pointerdown", onTrackPointerDown);
      rail.removeEventListener("keydown", onRailKeyDown);
      thumb.removeEventListener("pointerdown", onThumbPointerDown);
      thumb.removeEventListener("pointermove", onThumbPointerMove);
      thumb.removeEventListener("pointerup", onThumbPointerUp);
      thumb.removeEventListener("pointercancel", onThumbPointerUp);
      resizeObserver?.disconnect();
    };
  }, []);

  const scrollport = <div ref={scrollRef} {...props} id={scrollportId} />;
  return (
    <div className="horizontal-drag-scroll-shell">
      {scrollport}
      <div
        ref={railRef}
        className="horizontal-drag-scroll-rail"
        role="scrollbar"
        aria-orientation="horizontal"
        aria-controls={scrollportId}
        aria-valuemin={0}
        aria-valuemax={0}
        aria-valuenow={0}
        tabIndex={-1}
        hidden
      >
        <div ref={thumbRef} className="horizontal-drag-scroll-rail__thumb" aria-hidden="true" />
      </div>
    </div>
  );
}

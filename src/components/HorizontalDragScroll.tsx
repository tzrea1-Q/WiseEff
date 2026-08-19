import { useRef, type ComponentPropsWithoutRef } from "react";
import { useHorizontalDragScroll } from "@/hooks/useHorizontalDragScroll";

/** Overflowed table/list scrollport with pointer-drag pan. */
export function HorizontalDragScroll(props: ComponentPropsWithoutRef<"div">) {
  const ref = useRef<HTMLDivElement>(null);
  useHorizontalDragScroll(ref);
  return <div ref={ref} {...props} />;
}

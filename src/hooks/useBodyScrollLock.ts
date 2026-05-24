import { useEffect } from "react";

let scrollLockCount = 0;
let lockedOverflow = "";

export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) {
      return;
    }

    if (scrollLockCount === 0) {
      lockedOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }

    scrollLockCount += 1;

    return () => {
      scrollLockCount = Math.max(0, scrollLockCount - 1);
      if (scrollLockCount === 0) {
        document.body.style.overflow = lockedOverflow;
      }
    };
  }, [locked]);
}

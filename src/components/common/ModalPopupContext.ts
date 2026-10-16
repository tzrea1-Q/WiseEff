import { createContext } from "react";

// React context crosses portals, so popup consumers inherit their dialog's layer
// without moving into a scroll/clipping container or replacing Radix behavior.
export const ModalPopupContext = createContext(false);

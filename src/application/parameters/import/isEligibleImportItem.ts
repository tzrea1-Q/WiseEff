import type { ParameterImportBatchItem } from "@/application/ports/ParameterRepository";

export function isEligibleImportItem(item: ParameterImportBatchItem): boolean {
  return item.classification === "added" || item.classification === "updated";
}

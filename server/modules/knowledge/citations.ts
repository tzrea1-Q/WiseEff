export function formatKnowledgePageLabel(start: number, end = start): string {
  return `第 ${start}${end !== start ? `–${end}` : ""} 页`;
}

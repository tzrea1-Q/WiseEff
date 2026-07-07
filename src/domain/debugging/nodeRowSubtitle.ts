type NodeRowSubtitleSource = {
  id: string;
  key: string;
  description: string;
};

export function nodeRowSubtitle(row: NodeRowSubtitleSource): string {
  const key = row.key.trim();
  if (key && key !== row.id) {
    return key;
  }

  return row.description.trim();
}

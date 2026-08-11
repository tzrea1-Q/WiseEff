type DtsReloadCandidateMeaningProps = {
  meaning: string | null | undefined;
  /** Accessible name for the section heading. */
  headingId?: string;
};

/**
 * Standalone meaning block for the reload-candidate edit sheet.
 * Kept out of the basic metadata card so long documentation does not crowd the key facts.
 */
export function DtsReloadCandidateMeaning({ meaning, headingId }: DtsReloadCandidateMeaningProps) {
  const text = meaning?.trim() || "";
  const titleId = headingId ?? "dts-reload-candidate-meaning";

  return (
    <section className="dts-reload-candidate-meaning" aria-labelledby={titleId}>
      <h3 id={titleId}>参数含义</h3>
      {text ? (
        <p className="dts-reload-candidate-meaning__body">{text}</p>
      ) : (
        <p className="dts-reload-candidate-meaning__empty">暂无参数含义说明。</p>
      )}
    </section>
  );
}

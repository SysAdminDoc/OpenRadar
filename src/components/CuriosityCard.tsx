import { useT } from "../i18n";
import type { Curiosity } from "../lib/curiosities";

/**
 * A place where the weather made history, found by going there.
 *
 * A card, once, and nothing else: no toast, no sound, nothing that interrupts
 * whatever the reader was actually doing. It says what happened, who says so,
 * and where to read it, and one press sends it away.
 *
 * There is no count on it and no total. Somebody who finds two of these has
 * found two things they did not know; they are not two twelfths of the way
 * through anything.
 */
export function CuriosityCard({
  found,
  onDismiss,
}: {
  found: Curiosity;
  onDismiss: () => void;
}) {
  const t = useT();
  return (
    <section
      className="curiosity"
      aria-label={t("curiosity.title")}
      data-curiosity={found.id}
    >
      <div className="curiosity__title">
        <small>{t("curiosity.title")}</small>
        <span>{found.title}</span>
      </div>
      <p>{found.story}</p>
      <p className="source-note">
        <a href={found.url} target="_blank" rel="noreferrer noopener">
          {found.source}
        </a>
      </p>
      <button type="button" className="secondary-button" onClick={onDismiss}>
        {t("curiosity.dismiss")}
      </button>
    </section>
  );
}

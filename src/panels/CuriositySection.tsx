import { useEffect, useState } from "react";
import { useT } from "../i18n";
import {
  CURIOSITY_URL,
  inWords,
  readCuriosities,
  type Curiosity,
} from "../lib/curiosities";

/**
 * The places you have found, and the switch that stops there being any.
 *
 * A list of what somebody found, with no total beside it, no progress through
 * it, and nothing that says how many there are altogether. The moment it says
 * "three of twelve" it stops being a set of real places worth knowing about
 * and becomes a thing to complete, which is the one shape this feature must
 * not take.
 */
export function CuriositySection({
  found,
  onForget,
}: {
  found: readonly string[];
  onForget: () => void;
}) {
  const t = useT();
  const [set, setSet] = useState<Curiosity[]>([]);

  useEffect(() => {
    let open = true;
    void fetch(CURIOSITY_URL)
      .then((response) => (response.ok ? response.json() : []))
      .then((value) => {
        if (open) setSet(readCuriosities(value));
      })
      .catch(() => undefined);
    return () => {
      open = false;
    };
  }, []);

  return (
    <div className="curiosity-found" data-curiosity-list>
      <div className="settings-section__title">
        <span>{t("curiosity.found")}</span>
      </div>
      {found.length ? (
        <>
          <ul role="list">
            {found.map((id) => {
              const one = set.find((entry) => entry.id === id);
              return (
                <li key={id} data-curiosity-found={id}>
                  {/* The place's own name once the set has been read, and the
                      identifier until then, so the list is never empty while
                      a file loads. */}
                  <strong>{one ? inWords(one.title) : id}</strong>
                  {one ? (
                    <small>
                      <a
                        href={one.url}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {one.source}
                      </a>
                    </small>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <button type="button" className="secondary-button" onClick={onForget}>
            {t("curiosity.forget")}
          </button>
        </>
      ) : (
        <p className="source-note">{t("curiosity.foundEmpty")}</p>
      )}
    </div>
  );
}

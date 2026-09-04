import { useEffect, useRef } from "react";
import { translate } from "../i18n";

/**
 * What a machine with no WebGL2 sees instead of the map.
 *
 * The point is that the reader can do something. "The interface could not
 * finish drawing" is true of a missing context and useless; naming the setting
 * that turns it back on is not.
 */
export function NoGpu() {
  // The focus goes to the heading, because everything that had it is gone.
  // Left on the body, the next Tab starts from the top of the window and the
  // sentence that explains the screen is never reachable again.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <main className="fatal-error" role="alert">
      <div className="fatal-error__mark">!</div>
      <p className="eyebrow">{translate("gpu.eyebrow")}</p>
      <h1 ref={headingRef} tabIndex={-1}>
        {translate("gpu.title")}
      </h1>
      <p>{translate("gpu.body")}</p>
      <p>{translate("gpu.hint")}</p>
      <button type="button" onClick={() => window.location.reload()}>
        {translate("fatal.reload")}
      </button>
    </main>
  );
}

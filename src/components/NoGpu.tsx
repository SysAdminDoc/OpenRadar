import { translate } from "../i18n";

/**
 * What a machine with no WebGL2 sees instead of the map.
 *
 * The point is that the reader can do something. "The interface could not
 * finish drawing" is true of a missing context and useless; naming the setting
 * that turns it back on is not.
 */
export function NoGpu() {
  return (
    <main className="fatal-error" role="alert">
      <div className="fatal-error__mark">!</div>
      <p className="eyebrow">{translate("gpu.eyebrow")}</p>
      <h1>{translate("gpu.title")}</h1>
      <p>{translate("gpu.body")}</p>
      <p>{translate("gpu.hint")}</p>
      <button type="button" onClick={() => window.location.reload()}>
        {translate("fatal.reload")}
      </button>
    </main>
  );
}

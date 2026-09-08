import { render } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { translate } from "./index";
import { recentLog, subscribeLog } from "../lib/log";

afterEach(cleanup);

/**
 * A missing key is reported without turning the window into a spin.
 *
 * `translate` runs during render, and the log notifies its subscribers
 * synchronously over a snapshot whose identity changes on every write. The
 * workspace holds one of those subscriptions for the life of the window, so a
 * warning from inside `translate` rendered, warned, re-rendered and warned
 * again: a missing key went from one thrown error to `Maximum update depth
 * exceeded`, which is worse. This is the shape of that, in miniature.
 */
describe("what a missing key costs the window", () => {
  it("does not re-render the tree once per call", () => {
    let renders = 0;
    function Panel() {
      renders += 1;
      if (renders > 50) throw new Error(`runaway: ${renders} renders`);
      return <span>{translate("still.not.a.key" as never)}</span>;
    }
    function Root() {
      // The same subscription `App` holds, over the same snapshot.
      useSyncExternalStore(subscribeLog, recentLog);
      return <Panel />;
    }
    expect(() => render(<Root />)).not.toThrow();
    expect(renders).toBeLessThan(10);
  });
});

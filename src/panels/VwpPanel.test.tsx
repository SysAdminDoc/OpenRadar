import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VwpPanel } from "./VwpPanel";
import { en } from "../i18n/en";

afterEach(cleanup);

/**
 * What the panel says when it has no barbs to draw.
 *
 * Three silences that used to read as one. The native side answers with its
 * own `{code, args, text}` rather than an `Error`, so a check for one sent
 * every refusal to "not available here": a terminal radar, a time that would
 * not parse and a bucket that was down all looked identical. A replay was
 * told to hold a site under a map that plainly had one held. And an answer
 * with no columns in it drew an empty chart that read as still loading.
 */
describe("the wind profile with nothing to draw", () => {
  it("names the reason the native side gave", async () => {
    render(
      <VwpPanel
        station="TDAL"
        times={[]}
        read={() =>
          Promise.reject({
            code: "notWsr88d",
            args: ["TDAL"],
            text: "TDAL is a terminal radar",
          })
        }
        onClose={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/airport's terminal radar/)).toBeTruthy(),
    );
    // And not the catch-all that used to stand in for every failure.
    expect(screen.queryByText(en["radar.error.unknown"])).toBeNull();
  });

  it("keeps the catch-all for a rejection with no shape it knows", async () => {
    render(
      <VwpPanel
        station="KDMX"
        times={[]}
        read={() => Promise.reject(new Error("the socket closed"))}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("the socket closed")).toBeTruthy(),
    );
  });

  it("says so when the volumes came back with no wind in them", async () => {
    render(
      <VwpPanel
        station="KDMX"
        times={[]}
        read={() => Promise.resolve([])}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(en["vwp.nothingToDraw"])).toBeTruthy(),
    );
    // Rather than a height rail and a list that owns no list items.
    expect(document.querySelector(".vwp-chart")).toBeNull();
  });

  it("does not tell a reader in a replay to hold a site", async () => {
    // A replay hands over no station on purpose, because a historical hold
    // publishes no volume list and an empty list means "whatever the radar
    // put out last": the panel would draw this afternoon's wind under a map
    // showing 2011. Telling that reader to hold a site is wrong advice.
    render(
      <VwpPanel
        station={null}
        quiet="historical"
        times={[]}
        read={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(en["vwp.historical"])).toBeTruthy();
    expect(screen.queryByText(en["vwp.needsSite"])).toBeNull();
  });

  it("still asks a reader with no site at all to hold one", () => {
    render(
      <VwpPanel station={null} times={[]} read={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText(en["vwp.needsSite"])).toBeTruthy();
  });
});

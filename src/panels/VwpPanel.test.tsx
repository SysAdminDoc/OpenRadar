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

describe("the panel while the loop moves on", () => {
  const column = (volume: string) => ({
    volume,
    collected: "2026-09-04T18:00:00Z",
    levels: [
      {
        heightKm: 1,
        fromDegrees: 220,
        speedMs: 15,
        rangeKm: 20,
        elevationDegrees: 0.5,
        residualMs: 1,
        symmetryMs: 1,
        refused: null,
      },
    ],
  });

  it("asks again for a new volume without going back to the spinner", async () => {
    // A new volume every few minutes is the ordinary case, and the panel
    // used to be keyed on the volume list: it remounted, threw its answer
    // away, and drew a spinner while three volumes were read again.
    const asked: string[][] = [];
    const read = (_station: string, times: string[]) => {
      asked.push(times);
      return Promise.resolve([column(times.at(-1) ?? "one")]);
    };
    const view = render(
      <VwpPanel station="KDMX" times={["a"]} read={read} onClose={vi.fn()} />,
    );
    await waitFor(() => expect(asked).toHaveLength(1));
    await waitFor(() =>
      expect(document.querySelector(".vwp-chart")).not.toBeNull(),
    );

    view.rerender(
      <VwpPanel
        station="KDMX"
        times={["a", "b"]}
        read={read}
        onClose={vi.fn()}
      />,
    );
    // Asked again for the longer list, and the chart never left the screen.
    expect(document.querySelector(".vwp-chart")).not.toBeNull();
    await waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1]).toEqual(["a", "b"]);
  });

  it("asks again for a different site", async () => {
    // The other direction. Starting over for a new radar is the parent's
    // job, through the key it mounts this with; what the panel owes is the
    // ask, so that the columns cannot be the ones the last site answered.
    const asked: string[] = [];
    const read = (station: string) => {
      asked.push(station);
      return Promise.resolve([column(`${station}-volume`)]);
    };
    const view = render(
      <VwpPanel station="KDMX" times={["a"]} read={read} onClose={vi.fn()} />,
    );
    await waitFor(() => expect(asked).toEqual(["KDMX"]));
    view.rerender(
      <VwpPanel station="KTLX" times={["a"]} read={read} onClose={vi.fn()} />,
    );
    await waitFor(() => expect(asked).toEqual(["KDMX", "KTLX"]));
  });
});

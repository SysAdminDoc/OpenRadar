import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TropicalPanel } from "./TropicalPanel";
import { EMPTY_OVERLAY } from "../lib/overlays";
import { en } from "../i18n/en";

afterEach(cleanup);

function panel(fetchedAt: number | null, error: string | null) {
  return (
    <TropicalPanel
      products={EMPTY_OVERLAY}
      fetchedAt={fetchedAt}
      error={error}
      layerOn
      onEnableLayer={vi.fn()}
      onFollow={vi.fn()}
      onClose={vi.fn()}
    />
  );
}

describe("the tropical feed state", () => {
  it("does not call a pending or failed request an empty result", () => {
    const { rerender } = render(panel(null, null));
    expect(screen.queryByText(en["tropical.noneTitle"])).toBeNull();
    expect(
      screen.getAllByText(en["tropical.noteLoading"]).length,
    ).toBeGreaterThan(0);

    rerender(panel(null, "service unavailable"));
    expect(screen.queryByText(en["tropical.noneTitle"])).toBeNull();
    expect(screen.getByText(/service unavailable/)).toBeTruthy();
  });

  it("shows the empty state after a successful empty response", () => {
    render(panel(Date.now(), null));
    expect(screen.getByText(en["tropical.noneTitle"])).toBeTruthy();
  });
});

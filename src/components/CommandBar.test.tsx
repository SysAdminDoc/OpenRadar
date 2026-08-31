import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandBar } from "./CommandBar";

afterEach(cleanup);

describe("the compact command bar", () => {
  it("keeps the command palette as its route to the full workspace", () => {
    const onSurface = vi.fn();
    const { container } = render(
      <CommandBar
        activeSurface={null}
        activeTool={null}
        dualPane={false}
        projection="mercator"
        presets={[false, false, false]}
        onSurface={onSurface}
        onTool={vi.fn()}
        onLocate={vi.fn()}
        onDualPane={vi.fn()}
        onProjection={vi.fn()}
        onPreset={vi.fn()}
        onShare={vi.fn()}
      />,
    );

    const compact = container.querySelector(".compact-command-group");
    expect(compact).not.toBeNull();
    within(compact as HTMLElement)
      .getByRole("button", {
        name: "Commands",
      })
      .click();
    expect(onSurface).toHaveBeenCalledWith("commands");
  });
});

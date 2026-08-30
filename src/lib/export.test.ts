import { describe, expect, it } from "vitest";
import { exportFileName } from "./export";

describe("export file names", () => {
  it("stamps the moment so two exports never collide", () => {
    const name = exportFileName("openradar-loop", "webm");
    expect(name).toMatch(
      /^openradar-loop-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}\.webm$/,
    );
    expect(name).not.toContain(":");
    expect(name).not.toContain("/");
  });
});

import { describe, expect, it } from "vitest";
import { bulletForDepth, markerWidthEm, matchTaskBox } from "./list-widgets";

describe("list helpers", () => {
  it("cycles bullet glyphs by depth", () => {
    expect(bulletForDepth(1)).toBe("•");
    expect(bulletForDepth(2)).toBe("◦");
    expect(bulletForDepth(4)).toBe("•");
  });
  it("computes marker widths", () => {
    expect(markerWidthEm(1, "bullet")).toBe(1.5);
    expect(markerWidthEm(2, "bullet")).toBe(3);
    expect(markerWidthEm(1, "ordered")).toBe(2);
  });
  it("reads task boxes", () => {
    expect(matchTaskBox(" [x] done")).toEqual({ checked: true, length: 4 });
    expect(matchTaskBox(" [ ] todo")).toEqual({ checked: false, length: 4 });
    expect(matchTaskBox(" [link](x)")).toBeNull();
    expect(matchTaskBox(" plain")).toBeNull();
  });
});

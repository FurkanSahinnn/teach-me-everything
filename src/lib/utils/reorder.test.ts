import { describe, expect, it } from "vitest";
import { moveToPosition } from "./reorder";

describe("moveToPosition", () => {
  it("moves directly to either end without losing hidden rows", () => {
    const ids = ["a", "hidden", "b", "c"];
    expect(moveToPosition(ids, "a", "c")).toEqual(["hidden", "b", "c", "a"]);
    expect(moveToPosition(ids, "c", "a")).toEqual(["c", "a", "hidden", "b"]);
    expect(ids).toEqual(["a", "hidden", "b", "c"]);
    expect(moveToPosition(ids, "unknown", "a")).toEqual(ids);
  });
});

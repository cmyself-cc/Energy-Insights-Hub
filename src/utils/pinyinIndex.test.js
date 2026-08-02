import { describe, it, expect } from "vitest";
import { getInitial, initialsSequence } from "./pinyinIndex.js";

describe("pinyinIndex", () => {
  it("getInitial: Chinese → pinyin first letter", () => {
    expect(getInitial("发布")).toBe("F");
    expect(getInitial("中石油")).toBe("Z");
  });
  it("getInitial: English → uppercase first letter", () => {
    expect(getInitial("bp")).toBe("B");
    expect(getInitial("CATL")).toBe("C");
  });
  it("getInitial: digit/symbol → #", () => {
    expect(getInitial("123")).toBe("#");
    expect(getInitial("3M")).toBe("#");
  });
  it("initialsSequence: Chinese initials", () => {
    expect(initialsSequence("发布")).toBe("FB");
    expect(initialsSequence("宁德时代")).toBe("NDSD");
  });
  it("initialsSequence: English uppercase", () => {
    expect(initialsSequence("bp")).toBe("BP");
  });
  it("initialsSequence: mixed skips non-alphanumeric", () => {
    expect(initialsSequence("Shell 壳牌")).toBe("SHELLKP");
  });
});

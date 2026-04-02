import { describe, expect, test } from "bun:test";
import { stripJsoncComments, deepMerge } from "./config.js";

// ── Task 1: stripJsoncComments ──────────────────────────────────────

describe("stripJsoncComments", () => {
  test("removes single-line comments", () => {
    const input = `{
  // this is a comment
  "key": "value"
}`;
    const result = JSON.parse(stripJsoncComments(input));
    expect(result).toEqual({ key: "value" });
  });

  test("removes block comments", () => {
    const input = `{
  /* block comment */
  "key": "value"
}`;
    const result = JSON.parse(stripJsoncComments(input));
    expect(result).toEqual({ key: "value" });
  });

  test("removes multi-line block comments", () => {
    const input = `{
  /*
   * multi-line
   * block comment
   */
  "key": "value"
}`;
    const result = JSON.parse(stripJsoncComments(input));
    expect(result).toEqual({ key: "value" });
  });

  test("preserves URLs inside quoted strings", () => {
    const input = `{
  "url": "https://example.com/path",
  "another": "value"
}`;
    const result = JSON.parse(stripJsoncComments(input));
    expect(result).toEqual({
      url: "https://example.com/path",
      another: "value",
    });
  });

  test("preserves // inside quoted strings", () => {
    const input = `{
  "comment": "not // a comment",
  "key": "value"
}`;
    const result = JSON.parse(stripJsoncComments(input));
    expect(result).toEqual({
      comment: "not // a comment",
      key: "value",
    });
  });

  test("handles escaped quotes inside strings", () => {
    const input = `{
  "msg": "he said \\"hello\\"",
  "key": "value"
}`;
    const result = JSON.parse(stripJsoncComments(input));
    expect(result).toEqual({
      msg: 'he said "hello"',
      key: "value",
    });
  });

  test("handles empty input", () => {
    expect(stripJsoncComments("")).toBe("");
  });

  test("handles input with no comments", () => {
    const input = `{"key": "value"}`;
    expect(stripJsoncComments(input)).toBe(input);
  });

  test("removes trailing commas are not its job (just comments)", () => {
    // stripJsoncComments only strips comments; trailing commas are separate
    const input = `{
  "a": 1, // comment
  "b": 2
}`;
    const stripped = stripJsoncComments(input);
    const result = JSON.parse(stripped);
    expect(result).toEqual({ a: 1, b: 2 });
  });
});

// ── Task 1: deepMerge ───────────────────────────────────────────────

describe("deepMerge", () => {
  test("flat merge", () => {
    const target = { a: 1, b: 2 };
    const source = { b: 3, c: 4 };
    expect(deepMerge(target, source)).toEqual({ a: 1, b: 3, c: 4 });
  });

  test("deep nested merge", () => {
    const target = { outer: { a: 1, inner: { x: 10 } } };
    const source = { outer: { b: 2, inner: { y: 20 } } };
    expect(deepMerge(target, source)).toEqual({
      outer: { a: 1, b: 2, inner: { x: 10, y: 20 } },
    });
  });

  test("scalar override", () => {
    const target = { a: { nested: "old" } };
    const source = { a: "scalar" };
    expect(deepMerge(target, source)).toEqual({ a: "scalar" });
  });

  test("prototype pollution guard — __proto__", () => {
    const target = { a: 1 };
    const source = JSON.parse('{"__proto__": {"polluted": true}}');
    const result = deepMerge(target, source);
    expect(result).toEqual({ a: 1 });
    // Ensure prototype was not polluted
    expect(({} as any).polluted).toBeUndefined();
  });

  test("prototype pollution guard — constructor", () => {
    const target = { a: 1 };
    const source = { constructor: { polluted: true } } as any;
    const result = deepMerge(target, source);
    expect(result).toEqual({ a: 1 });
  });

  test("prototype pollution guard — prototype", () => {
    const target = { a: 1 };
    const source = { prototype: { polluted: true } } as any;
    const result = deepMerge(target, source);
    expect(result).toEqual({ a: 1 });
  });

  test("array replacement (not merged)", () => {
    const target = { tags: ["a", "b"] };
    const source = { tags: ["c"] };
    expect(deepMerge(target, source)).toEqual({ tags: ["c"] });
  });
});

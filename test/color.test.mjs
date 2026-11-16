import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHex, luminance, inkOn } from "../mods/git-graph/lib/color.js";

test("parseHex: #rgb, #rrggbb, #rrggbbaa; junk is null", () => {
  assert.deepEqual(parseHex("#fff"), [255, 255, 255]);
  assert.deepEqual(parseHex("#61afef"), [0x61, 0xaf, 0xef]);
  assert.deepEqual(parseHex("#61afef80"), [0x61, 0xaf, 0xef]);
  assert.equal(parseHex("rgb(1,2,3)"), null);
  assert.equal(parseHex(undefined), null);
});

test("luminance: black 0, white 1, green brighter than blue", () => {
  assert.equal(luminance("#000000"), 0);
  assert.equal(luminance("#ffffff"), 1);
  assert.ok(luminance("#00ff00") > luminance("#0000ff"));
  assert.equal(luminance("nope"), null);
});

test("inkOn: dark ink on light fills, light ink on dark fills", () => {
  const bg = "#282c34", fg = "#abb2bf"; // a dark theme
  assert.equal(inkOn("#e5c07b", bg, fg), bg, "yellow lane: dark text");
  assert.equal(inkOn("#61afef", bg, fg), bg, "light blue lane: dark text");
  assert.equal(inkOn("#1a3d8f", bg, fg), fg, "deep blue lane: light text");
  // A light theme: background light, foreground dark; still the better of the two.
  assert.equal(inkOn("#0b3d91", "#fafafa", "#383a42"), "#fafafa");
  assert.equal(inkOn("#f0d060", "#fafafa", "#383a42"), "#383a42");
  assert.equal(inkOn(undefined, bg, fg), bg, "unreadable fill keeps the old ink");
});

// utils.test.ts — run with:  node --test --experimental-strip-types utils.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { formatDuration, parseDuration } from "./utils.ts";

test("parseDuration multiplies by the unit", () => {
  assert.equal(parseDuration("1h30m"), 5400);
  assert.equal(parseDuration("90s"), 90);
  assert.equal(parseDuration("2h"), 7200);
});

test("formatDuration is the inverse", () => {
  assert.equal(formatDuration(5400), "1h30m");
  assert.equal(formatDuration(0), "0s");
});

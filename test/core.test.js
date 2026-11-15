import { test } from "node:test";
import assert from "node:assert/strict";

import {
  Deadline,
  DeadlineExceededError,
  withDeadline,
  currentDeadline,
  remainingMs,
  checkDeadline,
} from "../src/index.js";

// A controllable fake clock. Tests advance it explicitly so nothing depends on
// wall-clock time and every run is deterministic.
function fakeClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms) => {
      now += ms;
    },
  };
}

test("withDeadline without a budget is unbounded", () => {
  const ctx = withDeadline();
  assert.equal(ctx.isUnbounded(), true);
  assert.equal(ctx.deadlineMs, null);
  assert.equal(remainingMs(ctx), Infinity);
});

test("withDeadline computes an absolute instant from the clock", () => {
  const clock = fakeClock();
  const ctx = withDeadline(500, clock.now);
  assert.equal(ctx.deadlineMs, 1_000_500);
  assert.equal(ctx.isUnbounded(), false);
});

test("remaining decreases as the clock advances", () => {
  const clock = fakeClock();
  const ctx = withDeadline(1000, clock.now);
  assert.equal(remainingMs(ctx, clock.now), 1000);
  clock.advance(400);
  assert.equal(remainingMs(ctx, clock.now), 600);
});

test("remaining goes negative past the deadline rather than clamping", () => {
  const clock = fakeClock();
  const ctx = withDeadline(100, clock.now);
  clock.advance(250);
  assert.equal(remainingMs(ctx, clock.now), -150);
});

test("checkDeadline returns the context while time remains", () => {
  const clock = fakeClock();
  const ctx = withDeadline(100, clock.now);
  assert.equal(checkDeadline(ctx, clock.now), ctx);
});

test("checkDeadline throws once the deadline is reached", () => {
  const clock = fakeClock();
  const ctx = withDeadline(100, clock.now);
  clock.advance(100);
  assert.throws(
    () => checkDeadline(ctx, clock.now),
    (err) => {
      assert.ok(err instanceof DeadlineExceededError);
      assert.equal(err.deadlineMs, 1_000_100);
      return true;
    },
  );
});

test("checkDeadline on an unbounded context never throws", () => {
  const clock = fakeClock();
  clock.advance(1e12);
  const ctx = withDeadline();
  assert.equal(checkDeadline(ctx, clock.now).isUnbounded(), true);
});

test("child clamps a loose budget to the parent", () => {
  const clock = fakeClock();
  const parent = withDeadline(500, clock.now);
  const child = parent.child(5000, clock.now);
  assert.equal(child.deadlineMs, parent.deadlineMs);
});

test("child keeps a tighter budget of its own", () => {
  const clock = fakeClock();
  const parent = withDeadline(5000, clock.now);
  const child = parent.child(200, clock.now);
  assert.equal(child.deadlineMs, 1_000_200);
});

test("child of an unbounded parent is bounded only by its own budget", () => {
  const clock = fakeClock();
  const parent = withDeadline();
  const child = parent.child(300, clock.now);
  assert.equal(child.deadlineMs, 1_000_300);
});

test("currentDeadline tolerates null and undefined", () => {
  assert.equal(currentDeadline(null).isUnbounded(), true);
  assert.equal(currentDeadline(undefined).isUnbounded(), true);
  assert.equal(remainingMs(undefined), Infinity);
});

test("Deadline.after rejects a negative budget", () => {
  assert.throws(() => Deadline.after(-1), RangeError);
});

test("Deadline.after rejects a non-finite budget", () => {
  assert.throws(() => Deadline.after(Infinity), RangeError);
  assert.throws(() => Deadline.after(NaN), RangeError);
});

test("Deadline constructor rejects a non-finite instant", () => {
  assert.throws(() => new Deadline(NaN), TypeError);
  assert.throws(() => new Deadline(Infinity), TypeError);
});

test("Deadline instances are frozen", () => {
  const ctx = withDeadline(10, fakeClock().now);
  assert.equal(Object.isFrozen(ctx), true);
});

test("a zero budget expires immediately", () => {
  const clock = fakeClock();
  const ctx = withDeadline(0, clock.now);
  assert.throws(() => checkDeadline(ctx, clock.now), DeadlineExceededError);
});

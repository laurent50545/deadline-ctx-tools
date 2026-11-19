# deadline-ctx-tools

Pass a deadline down through nested calls without adopting a framework: a deadline is a plain immutable value you thread as an argument, and each level can tighten it but never loosen it.

```js
import {
  withDeadline,
  checkDeadline,
  DeadlineExceededError,
} from "./src/index.js";

async function fetchUser(ctx, id) {
  checkDeadline(ctx);
  // ... do work, passing ctx onward ...
  return { id };
}

async function handleRequest(parentCtx) {
  // Give this branch at most 200ms, but never more than the parent allows.
  const ctx = parentCtx.child(200);
  return fetchUser(ctx, 42);
}

const ctx = withDeadline(1000);
try {
  await handleRequest(ctx);
} catch (err) {
  if (err instanceof DeadlineExceededError) {
    console.error("gave up, deadline was", err.deadlineMs);
  } else {
    throw err;
  }
}
```

## Why this exists

Cancellation libraries usually ask you to install a runtime and wrap every call in a framework-specific context object. That is a lot of machinery when the only thing you need to propagate is "give up after this instant". This library keeps the deadline as an ordinary value: you pass it explicitly, so it survives `await`, `Promise.all`, and recursion without any ambient state. The trade-off is that you must thread the context through your own function signatures rather than reading it from a global; in exchange, two concurrent requests can never observe each other's deadlines, and nothing has to be installed.

## The edge you will hit

`remainingMs` returns a negative number once the deadline has passed instead of clamping to zero, and `Deadline.child` clamps a child budget to the parent's absolute instant rather than to the parent's remaining time. Both are deliberate: the first lets you measure an overrun, the second keeps a child from silently outliving its parent even if the parent's clock has already advanced.

## API

- `withDeadline(budgetMs?, clock?)` — create a context. Omit the budget for an unbounded context. `clock` defaults to `Date.now` and returns epoch milliseconds.
- `Deadline` — class holding an absolute `deadlineMs` (or `null`). `Deadline.after(budgetMs, clock?)` builds one; `child(budgetMs, clock?)` derives a tighter one; `remaining(clock?)` reports milliseconds left; `isUnbounded()` reports whether a deadline is set.
- `currentDeadline(ctx)` — normalise `null`/`undefined` to an unbounded context.
- `remainingMs(ctx, clock?)` — remaining milliseconds, `Infinity` when unbounded.
- `checkDeadline(ctx, clock?)` — throw `DeadlineExceededError` if expired, otherwise return the context.
- `DeadlineExceededError` — error carrying the missed `deadlineMs`.

## Interpretation note

A context is a single absolute instant. There is no separate "total budget" and "per-call budget"; a tighter child replaces the parent's instant. This is the one reading this library implements, and the tests exercise exactly that.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.


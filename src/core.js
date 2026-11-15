// deadline-ctx-tools: pass deadlines through nested calls without a framework.
//
// Design decision: a deadline is a plain immutable value carrying an absolute
// epoch-millisecond instant. We never store a "remaining duration" on the
// context, because a duration captured at the top of a call chain silently
// becomes wrong as the chain descends. Absolute instants compose: a child that
// wants a tighter budget passes min(parent, now + budget).
//
// Design decision: the context is threaded explicitly as an argument rather
// than stored in a module-level stack. Implicit ambient state breaks under
// async scheduling (interleaved awaits would see each other's deadlines), and
// the whole point of this library is to be safe under nested async calls.

/**
 * Thrown when a deadline has passed. Carries the deadline that was missed so
 * callers can log or re-wrap it without losing the original instant.
 */
export class DeadlineExceededError extends Error {
  /**
   * @param {number} deadlineMs absolute epoch milliseconds that were exceeded
   * @param {string} [message]
   */
  constructor(deadlineMs, message) {
    super(message ?? `deadline exceeded at ${deadlineMs}`);
    this.name = "DeadlineExceededError";
    this.deadlineMs = deadlineMs;
  }
}

/**
 * An immutable deadline context. `deadlineMs` is an absolute epoch-millisecond
 * instant, or `null` for "no deadline".
 */
export class Deadline {
  /**
   * Prefer `withDeadline` / `Deadline.after` over the constructor so the
   * absolute-instant convention is applied consistently.
   *
   * @param {number|null} deadlineMs
   */
  constructor(deadlineMs) {
    if (deadlineMs !== null && !Number.isFinite(deadlineMs)) {
      throw new TypeError("deadlineMs must be a finite number or null");
    }
    this.deadlineMs = deadlineMs;
    Object.freeze(this);
  }

  /**
   * Build a deadline `budgetMs` from now, using the supplied clock.
   * The clock is injected so tests never depend on wall-clock time.
   *
   * @param {number} budgetMs non-negative duration in milliseconds
   * @param {() => number} clock returns epoch milliseconds
   * @returns {Deadline}
   */
  static after(budgetMs, clock = Date.now) {
    if (!Number.isFinite(budgetMs) || budgetMs < 0) {
      throw new RangeError("budgetMs must be a non-negative finite number");
    }
    return new Deadline(clock() + budgetMs);
  }

  /** True when this context has no deadline. */
  isUnbounded() {
    return this.deadlineMs === null;
  }

  /**
   * Remaining milliseconds until the deadline, or `Infinity` when unbounded.
   * May be negative once the deadline has passed; we do not clamp, because a
   * caller may want to know by how much it overran.
   *
   * @param {() => number} clock
   * @returns {number}
   */
  remaining(clock = Date.now) {
    if (this.deadlineMs === null) return Infinity;
    return this.deadlineMs - clock();
  }

  /**
   * Derive a child context that is never looser than this one. A child budget
   * larger than the parent's remaining time is clamped to the parent.
   *
   * @param {number} budgetMs
   * @param {() => number} clock
   * @returns {Deadline}
   */
  child(budgetMs, clock = Date.now) {
    const child = Deadline.after(budgetMs, clock);
    if (this.deadlineMs === null) return child;
    return child.deadlineMs < this.deadlineMs ? child : this;
  }
}

/**
 * Create a deadline context. With no budget, returns an unbounded context.
 *
 * @param {number} [budgetMs]
 * @param {() => number} [clock]
 * @returns {Deadline}
 */
export function withDeadline(budgetMs, clock = Date.now) {
  if (budgetMs === undefined) return new Deadline(null);
  return Deadline.after(budgetMs, clock);
}

/**
 * Read the deadline from a context. Accepts `null`/`undefined` so callers can
 * pass an optional context through without guarding at every hop.
 *
 * @param {Deadline|null|undefined} ctx
 * @returns {Deadline}
 */
export function currentDeadline(ctx) {
  return ctx instanceof Deadline ? ctx : new Deadline(null);
}

/**
 * Remaining milliseconds for a context, tolerating a missing context.
 *
 * @param {Deadline|null|undefined} ctx
 * @param {() => number} [clock]
 * @returns {number}
 */
export function remainingMs(ctx, clock = Date.now) {
  return currentDeadline(ctx).remaining(clock);
}

/**
 * Throw when the context has expired. Call this at the top of any operation
 * that must respect the deadline; it is cheap and has no side effects.
 *
 * @param {Deadline|null|undefined} ctx
 * @param {() => number} [clock]
 * @returns {Deadline} the context, for chaining
 */
export function checkDeadline(ctx, clock = Date.now) {
  const d = currentDeadline(ctx);
  if (d.deadlineMs !== null && d.remaining(clock) <= 0) {
    throw new DeadlineExceededError(d.deadlineMs);
  }
  return d;
}

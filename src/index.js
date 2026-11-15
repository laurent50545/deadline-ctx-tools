// Public surface of deadline-ctx-tools. Re-exporting from a single entry point
// keeps the import path stable if the internal module layout changes.
export {
  Deadline,
  DeadlineExceededError,
  withDeadline,
  currentDeadline,
  remainingMs,
  checkDeadline,
} from "./core.js";

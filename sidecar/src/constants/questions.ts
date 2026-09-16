// How long a question can stay unanswered before the bus gives up and resolves
// it as "no answer" so the awaiting tool (and the turn) can settle. Questions are
// user-facing decisions that may take a while, so this is more generous than the
// permission timeout.
export const QUESTION_TIMEOUT_MS = 10 * 60_000;

export const QUESTION_LOG_PREFIX = "[question]";
export const QUESTION_TIMEOUT_REASON = "question timed out";
export const QUESTION_UNKNOWN_REQUEST_REASON = "unknown request id";

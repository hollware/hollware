/**
 * The limits every operation runs under, pinned for the adapters and the store (the v0.1 plan).
 */

/**
 * The largest answer of an operation, in UTF-8 bytes of its JSON. A larger one is the error
 * `output_too_large`, with a fix that says how to ask for less; content is never truncated.
 */
export const OUTPUT_CAP_BYTES = 1024 * 1024

/** How long an operation may take before it answers the error `timeout`. */
export const OPERATION_TIMEOUT_MS = 10_000

/**
 * The largest row the store writes, counted in UTF-8 bytes across all its columns. D1 refuses
 * rows over 2 MB in production, and Miniflare does not enforce it, so the store checks first.
 */
export const MAX_ROW_BYTES = 1_900_000

/** The most values bound in one statement: D1 allows 100, and lookups go in chunks of this. */
export const MAX_BOUND_PARAMETERS = 90

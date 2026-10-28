export const OUTPUT_CAP_BYTES = 1024 * 1024

export const OPERATION_TIMEOUT_MS = 10_000

/**
 * How long an open-world operation may take: one that asks a third party the site's owner chose,
 * whose answer can take longer than Hollware's own work. PostHog's query API answers
 * in 5 to 15 s.
 */
export const OPEN_WORLD_TIMEOUT_MS = 30_000

/**
 * The largest row the store writes, counted in UTF-8 bytes across all its columns. D1 refuses
 * rows over 2 MB in production, and Miniflare does not enforce it, so the store checks first.
 */
export const MAX_ROW_BYTES = 1_900_000

export const MAX_BOUND_PARAMETERS = 90
